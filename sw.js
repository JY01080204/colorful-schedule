/* 彩色日程 · Service Worker：离线缓存 + Web Push 推送接收 */
'use strict';

const CACHE_NAME = 'schedule-planner-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/ics.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

/* ---------- Web Push 推送消息 ---------- */
self.addEventListener('push', (e) => {
  let data = { title: '彩色日程提醒', body: '', tag: 'remind-' + Date.now() };
  try {
    if (e.data) data = Object.assign(data, e.data.json());
  } catch (err) { /* 非 JSON 载荷时使用默认值 */ }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'remind-' + Date.now(),
      vibrate: [200, 100, 200],
      data: { url: './index.html' },
    })
  );
});

/* 点击通知：聚焦或打开应用 */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(target); return c.focus(); }
      }
      return clients.openWindow(target);
    })
  );
});

/* 用户手动关闭通知 */
self.addEventListener('notificationclose', (e) => {
  /* 预留：可在此取消未完成任务 */
});
