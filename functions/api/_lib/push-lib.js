'use strict';
/* =========================================================
 * 彩色日程 · Web Push 核心（Cloudflare Pages Functions 版）
 * 纯 WebCrypto 实现：VAPID 签名 + RFC 8291 aes128gcm 加密，
 * 兼容 workerd（Cloudflare）与 Node（本地测试）。
 * 密钥格式：web-push 生成的原始格式
 *   publicKey  = base64url(未压缩公钥 65B)
 *   privateKey = base64url(32B 私钥标量)
 * ========================================================= */

/* ---------- 基础工具 ---------- */
function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function b64ToU8(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function u8ToB64url(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const te = new TextEncoder();

function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/* HKDF-Extract（RFC 5869 §2.2）= HMAC-SHA256(salt, IKM)，返回 32 字节 */
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}

/* HKDF-Expand（RFC 5869 §2.3）：T(i) = HMAC(PRK, T(i-1) || info || i) */
async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let t = new Uint8Array(0);
  let out = new Uint8Array(0);
  let counter = 1;
  while (out.length < length) {
    if (counter > 255) throw new Error('HKDF-Expand 长度超限');
    t = new Uint8Array(await crypto.subtle.sign('HMAC', key, concatBytes(t, info, new Uint8Array([counter]))));
    out = concatBytes(out, t);
    counter++;
  }
  return out.slice(0, length);
}

/* ---------- 密钥导入 ---------- */
function ecJwkFromRaw(pubB64, privB64) {
  const pub = b64ToU8(pubB64);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: u8ToB64url(pub.slice(1, 33)),
    y: u8ToB64url(pub.slice(33, 65)),
    d: u8ToB64url(b64ToU8(privB64)),
  };
}

async function importEcPair(pubB64, privB64) {
  const jwk = ecJwkFromRaw(pubB64, privB64);
  const publicKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { publicKey, privateKey };
}

async function importEcdsaPrivate(pubB64, privB64) {
  const jwk = ecJwkFromRaw(pubB64, privB64);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/* ---------- VAPID JWT（ES256） ---------- */
async function vapidJwt(aud, subject, pubB64, privB64) {
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const h = u8ToB64url(te.encode(JSON.stringify(header)));
  const p = u8ToB64url(te.encode(JSON.stringify(payload)));
  const key = await importEcdsaPrivate(pubB64, privB64);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + p)));
  return h + '.' + p + '.' + u8ToB64url(sig);
}

/* ---------- RFC 8291 aes128gcm 加密 ---------- */
async function encryptPayload(payloadBytes, uaPublicB64, authSecretB64, salt, asPair) {
  const uaPub = b64ToU8(uaPublicB64);
  const auth = b64ToU8(authSecretB64);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256));
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));

  // RFC 8291 §3.4（HMAC 展开为独立步骤）：
  // PRK_key = Extract(auth_secret, ecdh_secret)
  // IKM = Expand(PRK_key, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  // PRK = Extract(salt, IKM)
  // CEK = Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16)
  // NONCE = Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
  const prkKey = await hkdfExtract(auth, shared);
  const keyInfo = concatBytes(te.encode('WebPush: info\0'), uaPub, asPub);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, te.encode('Content-Encoding: nonce\0'), 12);

  // RFC 8291：明文 = 消息 || 0x02（填充定界符，单记录）
  const plain = concatBytes(payloadBytes, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plain));

  const RS = 4096;
  const body = new Uint8Array(16 + 4 + 1 + 65 + ct.length);
  body.set(salt, 0);
  body[16] = (RS >>> 24) & 255; body[17] = (RS >>> 16) & 255; body[18] = (RS >>> 8) & 255; body[19] = RS & 255;
  body[20] = 65;
  body.set(asPub, 21);
  body.set(ct, 86);
  return body;
}

/* ---------- 发送一条推送 ---------- */
async function sendPush(subscription, payloadObj, env) {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { status: 0, error: '缺少 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 环境变量' };
  const subject = env.VAPID_SUBJECT || 'mailto:schedule-planner@localhost';

  const asPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload(te.encode(JSON.stringify(payloadObj)), subscription.keys.p256dh, subscription.keys.auth, salt, asPair);
  const aud = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(aud, subject, pub, priv);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '300',
      'Authorization': 'vapid t=' + jwt + ', k=' + pub,
    },
    body,
  });
  return { status: res.status };
}

/* ---------- KV 存储与调度 ---------- */
function sanitizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(t => t && t.id && t.title)
    .map(t => ({
      id: String(t.id),
      title: String(t.title).slice(0, 80),
      remindAt: Number.isFinite(t.remindAt) ? Number(t.remindAt) : null,
      done: !!t.done,
    }))
    .filter(t => t.remindAt !== null);
}

async function readSubs(env) {
  const raw = await env.PUSH_KV.get('subs');
  if (!raw) return [];
  try { const d = JSON.parse(raw); return Array.isArray(d) ? d : []; }
  catch (e) { return []; }
}

async function writeSubs(env, subs) {
  await env.PUSH_KV.put('subs', JSON.stringify(subs));
}

/* 订阅 + 任务同步 */
async function processSync(env, body) {
  if (!body || !body.subscription || !body.subscription.endpoint || !body.subscription.keys ||
      !body.subscription.keys.p256dh || !body.subscription.keys.auth) {
    return { ok: false, error: '无效的订阅信息' };
  }
  const subs = await readSubs(env);
  let s = subs.find(x => x.endpoint === body.subscription.endpoint);
  if (!s) {
    s = { endpoint: body.subscription.endpoint, keys: body.subscription.keys, tasks: [], sent: [] };
    subs.push(s);
  }
  s.keys = body.subscription.keys;
  const clean = sanitizeTasks(body.tasks);
  const alive = new Set(clean.map(t => t.id));
  s.sent = (s.sent || []).filter(k => alive.has(k.slice(0, k.lastIndexOf('@'))));
  s.tasks = clean;
  await writeSubs(env, subs);
  return { ok: true, count: clean.length };
}

/* 取消订阅 */
async function processUnsubscribe(env, body) {
  if (!body || !body.endpoint) return { ok: false, error: '缺少 endpoint' };
  const subs = await readSubs(env);
  const next = subs.filter(x => x.endpoint !== body.endpoint);
  if (next.length !== subs.length) await writeSubs(env, next);
  return { ok: true };
}

/* 测试推送 */
async function processTest(env, body) {
  if (!body || !body.subscription) return { ok: false, error: '缺少订阅信息' };
  const r = await sendPush(body.subscription, {
    title: body.title || '彩色日程',
    body: body.body || '这是一条测试推送 ✔',
    tag: 'push-test-' + Date.now(),
  }, env);
  return { ok: r.status === 201 || r.status === 202, statusCode: r.status, gone: r.status === 404 || r.status === 410 };
}

/* 定时检查（由 cron-job.org 每分钟唤醒） */
async function processCheck(env) {
  if (!env.PUSH_KV) return { ok: false, error: 'PUSH_KV 未绑定' };
  try {
    const subs = await readSubs(env);
    const now = Date.now();
    const WINDOW = 5 * 60 * 1000;
    const STALE = 24 * 60 * 60 * 1000;
    let changed = false;
    let pushed = 0;
    const kept = [];

    for (const s of subs) {
      const sub = { endpoint: s.endpoint, keys: s.keys };
      let gone = false;
      for (const t of s.tasks || []) {
        if (t.done || t.remindAt === null) continue;
        if (now < t.remindAt || now > t.remindAt + WINDOW) continue;
        const key = t.id + '@' + t.remindAt;
        if ((s.sent || []).includes(key)) continue;

        s.sent = (s.sent || []).filter(k => now - Number(k.slice(k.lastIndexOf('@') + 1)) < STALE);
        s.sent.push(key);
        changed = true;

        const r = await sendPush(sub, {
          title: '彩色日程提醒',
          body: '⏰ ' + t.title,
          tag: 'remind-' + t.id,
        }, env);
        if (r.status === 404 || r.status === 410) { gone = true; break; }
        pushed++;
      }
      if (!gone) kept.push(s);
    }

    if (changed || kept.length !== subs.length) await writeSubs(env, kept);
    return { ok: true, checked: subs.length, pushed };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function getPublicKey(env) { return env.VAPID_PUBLIC_KEY || null; }

module.exports = {
  json, b64ToU8, u8ToB64url, hkdfExtract, hkdfExpand, concatBytes, te,
  importEcPair, importEcdsaPrivate, vapidJwt, encryptPayload, sendPush,
  sanitizeTasks, processSync, processUnsubscribe, processTest, processCheck, getPublicKey,
};
