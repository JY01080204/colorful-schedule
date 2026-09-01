// 彩色日程 · 静态服务器 + Web Push 推送（零运行时依赖：web-push 除外）
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const push = require('./push');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8123;
const HOST = process.env.HOST || '0.0.0.0';   // 监听所有网卡，手机可同 Wi-Fi 访问
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ics': 'text/calendar; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

push.init();

/* ---------- API 路由 ---------- */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) req.destroy();
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // 允许跨域（方便以后把页面静态托管、推送服务分开部署）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && p === '/api/vapid-public-key') {
    return json(200, { publicKey: push.getPublicKey() });
  }
  if (req.method === 'POST' && p === '/api/push-sync') {
    const body = await readBody(req);
    if (!body) return json(400, { ok: false, error: '请求体格式错误' });
    return json(200, push.handleSync(body.subscription, body.tasks));
  }
  if (req.method === 'POST' && p === '/api/push-unsubscribe') {
    const body = await readBody(req);
    if (!body || !body.endpoint) return json(400, { ok: false, error: '缺少 endpoint' });
    return json(200, push.handleUnsubscribe(body.endpoint));
  }
  if (req.method === 'POST' && p === '/api/push-test') {
    const body = await readBody(req);
    if (!body || !body.subscription) return json(400, { ok: false, error: '缺少订阅信息' });
    const r = await push.sendTest(body.subscription, body.title, body.body);
    return json(200, r);
  }
  return json(404, { ok: false, error: '接口不存在' });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad Request'); }

  if (urlPath === '/api' || urlPath.startsWith('/api/')) return handleApi(req, res);

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');

  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (err2, data) => {
      if (err2) { res.writeHead(404); return res.end('404 Not Found'); }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('彩色日程已启动: http://127.0.0.1:' + PORT + '/');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) {
      if (ni.family === 'IPv4' && !ni.internal) {
        console.log('📱 手机同 Wi-Fi 访问: http://' + ni.address + ':' + PORT + '/');
      }
    }
  }
  push.startScheduler(20000);
});
