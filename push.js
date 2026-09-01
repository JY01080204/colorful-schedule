/* =========================================================
 * 彩色日程 · Web Push 推送服务
 * 负责：VAPID 密钥管理 / 订阅与任务存储 / 定时调度推送
 * 说明：任务的提醒时间由客户端换算成 UTC 毫秒时间戳（remindAt）
 *       传上来，服务端只做“到点推送”，不受服务器时区影响。
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const DATA_FILE = path.join(__dirname, 'push-data.json');
const KEY_FILE = path.join(__dirname, 'vapid-keys.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:schedule-planner@localhost';

let vapid = null;          // { publicKey, privateKey }
let subs = [];             // [{ endpoint, keys, tasks:[{id,title,remindAt,done}], sent:['id@epoch'] }]
let saveTimer = null;

/* ---------- VAPID 密钥 ---------- */
function loadKeys() {
  // 优先使用环境变量（适合部署到 Render 等云平台，重启后密钥不变）
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    console.log('使用环境变量提供的 VAPID 密钥');
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const d = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      if (d.publicKey && d.privateKey) return d;
    }
  } catch (e) { console.warn('读取 VAPID 密钥失败，将重新生成：', e.message); }
  const k = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEY_FILE, JSON.stringify(k, null, 2));
  console.log('已生成新的 VAPID 密钥对 → vapid-keys.json');
  return k;
}

/* ---------- 订阅数据持久化 ---------- */
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(d.subs)) subs = d.subs;
    }
  } catch (e) { console.warn('读取推送数据失败：', e.message); }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify({ subs }, null, 2)); }
    catch (e) { console.warn('保存推送数据失败：', e.message); }
  }, 800);
}

/* ---------- 初始化 ---------- */
function init() {
  vapid = loadKeys();
  loadData();
  webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
}

function getPublicKey() { return vapid ? vapid.publicKey : null; }

/* ---------- 任务清洗 ---------- */
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
    .filter(t => t.remindAt !== null);   // 只保留设了提醒的任务
}

function keyId(key) { return key.slice(0, key.lastIndexOf('@')); }
function keyEpoch(key) { return Number(key.slice(key.lastIndexOf('@') + 1)); }

/* ---------- API 处理 ---------- */
function handleSync(subscription, tasks) {
  if (!subscription || !subscription.endpoint || !subscription.keys ||
      !subscription.keys.p256dh || !subscription.keys.auth) {
    return { ok: false, error: '无效的订阅信息' };
  }
  const clean = sanitizeTasks(tasks);
  let s = subs.find(x => x.endpoint === subscription.endpoint);
  if (!s) {
    s = { endpoint: subscription.endpoint, keys: subscription.keys, tasks: [], sent: [] };
    subs.push(s);
  }
  s.keys = subscription.keys;
  const alive = new Set(clean.map(t => t.id));
  s.sent = s.sent.filter(k => alive.has(keyId(k)));   // 清理已删除任务的发送记录
  s.tasks = clean;
  scheduleSave();
  return { ok: true, count: clean.length };
}

function handleUnsubscribe(endpoint) {
  const before = subs.length;
  subs = subs.filter(x => x.endpoint !== endpoint);
  if (subs.length !== before) scheduleSave();
  return { ok: true };
}

/* ---------- 发送 ---------- */
async function sendRaw(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 300 });
    return { ok: true };
  } catch (e) {
    const sc = e.statusCode;
    if (sc === 404 || sc === 410) {
      // 订阅已失效，移除
      subs = subs.filter(x => x.endpoint !== subscription.endpoint);
      scheduleSave();
      return { ok: false, gone: true };
    }
    return { ok: false, statusCode: sc || 0, message: String(e.message).slice(0, 120) };
  }
}

async function sendTest(subscription, title, body) {
  return sendRaw(subscription, {
    title: title || '彩色日程',
    body: body || '这是一条测试推送 ✔',
    tag: 'push-test-' + Date.now(),
  });
}

/* ---------- 定时调度 ---------- */
async function tick() {
  const now = Date.now();
  const WINDOW = 5 * 60 * 1000;        // 提醒时间点后 5 分钟内触发
  const STALE = 24 * 60 * 60 * 1000;   // 发送记录保留 24 小时
  let changed = false;

  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: s.keys };
    for (const t of s.tasks) {
      if (t.done || t.remindAt === null) continue;
      if (now < t.remindAt || now > t.remindAt + WINDOW) continue;
      const key = t.id + '@' + t.remindAt;
      if (s.sent.includes(key)) continue;

      s.sent = s.sent.filter(k => now - keyEpoch(k) < STALE);
      s.sent.push(key);
      changed = true;

      const r = await sendRaw(sub, {
        title: '彩色日程提醒',
        body: '⏰ ' + t.title,
        tag: 'remind-' + t.id,
      });
      if (r.gone) break;   // 该订阅已失效并被移除
    }
  }
  if (changed) scheduleSave();
}

function startScheduler(intervalMs) {
  const iv = intervalMs || 20000;
  setTimeout(tick, 1500);   // 启动后立即检查一次
  setInterval(tick, iv);
  console.log('推送调度已启动（每 ' + (iv / 1000) + ' 秒检查一次提醒）');
}

module.exports = { init, getPublicKey, handleSync, handleUnsubscribe, sendTest, startScheduler };
