/* =========================================================
 * 彩色日程 · 规划小助手
 * 功能：月历视图 / 彩色任务标记 / 浏览器通知+提示音提醒 /
 *       .ics 日历导入导出 / JSON 备份恢复 / PWA 离线可用
 * ========================================================= */
'use strict';

/* ---------- 常量与状态 ---------- */
const STORE_KEY = 'schedule-planner-data-v1';
const COLORS = ['#4f8cff', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
const COLOR_NAMES = ['工作蓝', '生活绿', '学习橙', '重要红', '浪漫紫', '健康青', '运动橙', '沉稳灰'];

const state = {
  tasks: [],
  year: new Date().getFullYear(),
  month: new Date().getMonth(),   // 0-11
  selected: todayStr(),
  editingId: null,
  muted: false,
  notifiedIds: [],
  pushReady: false,   // Web Push 是否已订阅
};

/* ---------- 工具函数 ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return fmt(new Date()); }
function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function $(id) { return document.getElementById(id); }

/* ---------- 本地存储 ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.tasks)) state.tasks = d.tasks;
    if (typeof d.muted === 'boolean') state.muted = d.muted;
    if (Array.isArray(d.notifiedIds)) state.notifiedIds = d.notifiedIds;
  } catch (e) { console.warn('读取本地数据失败', e); }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tasks: state.tasks,
      muted: state.muted,
      notifiedIds: state.notifiedIds,
    }));
  } catch (e) { toast('⚠️ 保存失败：浏览器存储空间不足'); }
}

/* ---------- 查询 ---------- */
function tasksOf(dateStr) {
  return state.tasks
    .filter(t => t.date === dateStr)
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    });
}

/* ---------- 日历渲染 ---------- */
function renderCalendar() {
  const grid = $('calendarGrid');
  const first = new Date(state.year, state.month, 1);
  const startOffset = (first.getDay() + 6) % 7;   // 周一为每周第一天
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="day-cell empty"></div>');

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = state.year + '-' + pad2(state.month + 1) + '-' + pad2(d);
    const list = tasksOf(dateStr);
    const visible = list.slice(0, 3);
    const more = list.length - visible.length;

    const cls = ['day-cell'];
    if (dateStr === today) cls.push('today');
    if (dateStr === state.selected) cls.push('selected');

    const chips = visible.map(t => {
      const bg = t.color + '26';   // 15% 透明度底色
      const fg = t.color;
      const strike = t.done ? 'text-decoration:line-through;opacity:.6;' : '';
      return '<span class="chip" title="' + esc(t.title) + '" style="background:' + bg + ';color:' + fg + ';' + strike + '">' + esc(t.title) + '</span>';
    }).join('');
    const moreHtml = more > 0 ? '<span class="chip-more">+' + more + ' 项</span>' : '';

    cells.push(
      '<div class="' + cls.join(' ') + '" data-date="' + dateStr + '">' +
        '<span class="day-num">' + d + '</span>' +
        '<div class="day-chips">' + chips + moreHtml + '</div>' +
      '</div>'
    );
  }
  while (cells.length % 7) cells.push('<div class="day-cell empty"></div>');

  grid.innerHTML = cells.join('');
  $('monthTitle').textContent = state.year + ' 年 ' + (state.month + 1) + ' 月';
}

/* ---------- 右侧任务面板 ---------- */
function renderDayPanel() {
  const dateStr = state.selected;
  const list = tasksOf(dateStr);

  $('dayTitle').textContent = dateStr + ' 的任务';
  $('dayCount').textContent = list.length ? '共 ' + list.length + ' 项' : '';

  const listEl = $('taskList');
  if (!list.length) {
    listEl.innerHTML = '<div class="empty-tip">这一天还没有安排<br>在下面添加一个任务吧 ✨</div>';
    return;
  }

  listEl.innerHTML = list.map(t => {
    const meta = [];
    meta.push(t.time ? t.time : '全天');
    if (t.reminder !== null && t.reminder !== undefined && t.reminder !== '') {
      meta.push(Number(t.reminder) === 0 ? '⏰ 准时提醒' : '⏰ 提前 ' + t.reminder + ' 分钟');
    }
    return (
      '<div class="task-item" style="--c:' + t.color + '" data-id="' + t.id + '">' +
        '<label class="check"><input type="checkbox" data-act="toggle" ' + (t.done ? 'checked' : '') + '></label>' +
        '<div class="task-body' + (t.done ? ' done' : '') + '">' +
          '<div class="task-title">' + esc(t.title) + '</div>' +
          '<div class="task-meta">' + esc(meta.join(' · ')) + '</div>' +
        '</div>' +
        '<button class="icon-btn" data-act="edit" title="编辑">✎</button>' +
        '<button class="icon-btn del" data-act="del" title="删除">🗑</button>' +
      '</div>'
    );
  }).join('');
}

/* ---------- 颜色选择器 ---------- */
function renderSwatches() {
  const box = $('colorSwatches');
  box.innerHTML = COLORS.map((c, i) =>
    '<button type="button" class="swatch" data-color="' + c + '" title="' + COLOR_NAMES[i] + '" style="background:' + c + '"></button>'
  ).join('');
}

function selectSwatch(color) {
  document.querySelectorAll('.swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

/* ---------- 表单 ---------- */
function resetForm() {
  state.editingId = null;
  $('taskId').value = '';
  $('fTitle').value = '';
  $('fDate').value = state.selected;
  $('fTime').value = '';
  $('fAllDay').checked = false;
  $('fReminder').value = '';
  $('fTime').disabled = false;
  $('submitBtn').textContent = '＋ 添加任务';
  $('cancelEditBtn').hidden = true;
  selectSwatch(COLORS[0]);
}

function fillForm(t) {
  state.editingId = t.id;
  $('taskId').value = t.id;
  $('fTitle').value = t.title;
  $('fDate').value = t.date;
  $('fAllDay').checked = !t.time;
  $('fTime').value = t.time || '';
  $('fTime').disabled = !t.time;
  $('fReminder').value = t.reminder === null || t.reminder === undefined ? '' : String(t.reminder);
  $('submitBtn').textContent = '✓ 保存修改';
  $('cancelEditBtn').hidden = false;
  selectSwatch(t.color);
}

function handleSubmit(e) {
  e.preventDefault();
  const title = $('fTitle').value.trim();
  const date = $('fDate').value;
  if (!title) { toast('请填写任务内容'); return; }
  if (!date) { toast('请选择日期'); return; }

  const allDay = $('fAllDay').checked;
  const time = allDay ? null : ($('fTime').value || null);
  const activeSwatch = document.querySelector('.swatch.active');
  const color = activeSwatch ? activeSwatch.dataset.color : COLORS[0];
  const reminderRaw = $('fReminder').value;
  const reminder = reminderRaw === '' ? null : Number(reminderRaw);

  const editing = state.editingId ? state.tasks.find(t => t.id === state.editingId) : null;

  if (editing) {
    editing.title = title;
    editing.date = date;
    editing.time = time;
    editing.color = color;
    editing.reminder = reminder;
    // 编辑后允许再次提醒
    state.notifiedIds = state.notifiedIds.filter(id => id !== editing.id);
    toast('已保存修改 ✔');
  } else {
    state.tasks.push({ id: uid(), title, date, time, color, reminder, done: false });
    toast('已添加到 ' + date + ' ✔');
  }

  save();
  state.selected = date;
  resetForm();
  renderCalendar();
  renderDayPanel();
  checkReminders();
  syncCurrentTasks();   // 推送：同步最新任务到服务端
}

function deleteTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm('删除「' + t.title + '」？')) return;
  state.tasks = state.tasks.filter(x => x.id !== id);
  state.notifiedIds = state.notifiedIds.filter(x => x !== id);
  if (state.editingId === id) resetForm();
  save();
  renderCalendar();
  renderDayPanel();
  toast('已删除');
  syncCurrentTasks();
}

function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) state.notifiedIds = state.notifiedIds.filter(x => x !== id);
  save();
  renderCalendar();
  renderDayPanel();
  syncCurrentTasks();
}

/* ---------- 提醒：通知 + 声音 ---------- */
let audioCtx = null;

function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1174.66].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      g.connect(audioCtx.destination);
      const t0 = now + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  } catch (e) { /* 音频不可用时静默 */ }
}

function fireReminder(t) {
  const text = (t.time ? t.time + ' · ' : '') + t.title;
  toast('⏰ ' + text, 7000);
  if (!state.muted) chime();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('彩色日程提醒', {
        body: text,
        icon: 'icons/icon-192.png',
        tag: 'remind-' + t.id,
        requireInteraction: false,
      });
    } catch (e) { /* 通知失败不影响 */ }
  }
}

function remindAtOf(t) {
  if (!t.time) return null;
  if (t.reminder === null || t.reminder === undefined || t.reminder === '') return null;
  const parts = t.date.split('-').map(Number);
  const tp = t.time.split(':').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], tp[0], tp[1]).getTime() - Number(t.reminder) * 60000;
}

function checkReminders() {
  const now = Date.now();
  let fired = false;
  for (const t of state.tasks) {
    if (t.done) continue;
    const at = remindAtOf(t);
    if (at === null || at === undefined) continue;
    // 提醒时间窗口：到达提醒时间后 5 分钟内触发一次
    if (now >= at && now <= at + 5 * 60000 && !state.notifiedIds.includes(t.id)) {
      state.notifiedIds.push(t.id);
      fireReminder(t);
      fired = true;
    }
  }
  if (fired) save();
}

/* ---------- .ics 导入导出 ---------- */
function exportICS() {
  if (!state.tasks.length) { toast('还没有任何任务可导出'); return; }
  const ics = buildICS(state.tasks);
  const name = 'colorful-schedule-' + todayStr().replace(/-/g, '') + '.ics';
  downloadBlob(name, ics, 'text/calendar;charset=utf-8');
  toast('已导出 ' + state.tasks.length + ' 条日程为 .ics 文件 📅');
}

function importICSFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseICS(reader.result);
    if (!parsed.length) { toast('未在文件中找到可导入的日程'); return; }
    let added = 0;
    for (const p of parsed) {
      const dup = state.tasks.some(t =>
        t.date === p.date && t.time === p.time && t.title === p.title
      );
      if (dup) continue;
      state.tasks.push(p);
      added++;
    }
    save();
    renderCalendar();
    renderDayPanel();
    toast('导入完成：新增 ' + added + ' 条（跳过 ' + (parsed.length - added) + ' 条重复）📥');
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------- JSON 备份/恢复 ---------- */
function backupJSON() {
  if (!state.tasks.length) { toast('还没有任何数据可备份'); return; }
  const payload = { version: 1, exportedAt: new Date().toISOString(), tasks: state.tasks };
  downloadBlob('schedule-backup-' + todayStr().replace(/-/g, '') + '.json',
    JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('数据已备份为 JSON 文件 💾');
}

function restoreJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      const list = Array.isArray(d.tasks) ? d.tasks : (Array.isArray(d) ? d : null);
      if (!list) throw new Error('bad format');
      if (!confirm('恢复将覆盖当前全部数据（' + state.tasks.length + ' 条），确定继续？')) return;
      state.tasks = list.map(t => ({
        id: t.id || uid(),
        title: String(t.title || '未命名'),
        date: String(t.date || todayStr()),
        time: t.time || null,
        color: COLORS.includes(t.color) ? t.color : COLORS[0],
        reminder: (t.reminder === undefined || t.reminder === null) ? null : Number(t.reminder),
        done: !!t.done,
      }));
      state.notifiedIds = [];
      save();
      renderCalendar();
      renderDayPanel();
      toast('恢复完成：共 ' + state.tasks.length + ' 条任务 ♻');
      syncCurrentTasks();
    } catch (e) {
      toast('⚠️ 备份文件格式不正确');
    }
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------- 提示条 ---------- */
let toastTimer = null;
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('prevMonth').addEventListener('click', () => { state.month--; if (state.month < 0) { state.month = 11; state.year--; } renderCalendar(); });
  $('nextMonth').addEventListener('click', () => { state.month++; if (state.month > 11) { state.month = 0; state.year++; } renderCalendar(); });
  $('todayBtn').addEventListener('click', () => {
    const t = new Date();
    state.year = t.getFullYear(); state.month = t.getMonth(); state.selected = todayStr();
    renderCalendar(); renderDayPanel();
  });

  $('calendarGrid').addEventListener('click', e => {
    const cell = e.target.closest('.day-cell');
    if (!cell || cell.classList.contains('empty')) return;
    state.selected = cell.dataset.date;
    resetForm();
    renderCalendar();
    renderDayPanel();
  });

  $('taskList').addEventListener('click', e => {
    const item = e.target.closest('.task-item');
    if (!item) return;
    const id = item.dataset.id;
    const act = e.target.dataset.act;
    if (act === 'edit') { const t = state.tasks.find(x => x.id === id); if (t) { state.selected = t.date; renderCalendar(); fillForm(t); } }
    else if (act === 'del') deleteTask(id);
  });

  $('taskList').addEventListener('change', e => {
    if (e.target.dataset.act === 'toggle') {
      const item = e.target.closest('.task-item');
      if (item) toggleTask(item.dataset.id);
    }
  });

  $('taskForm').addEventListener('submit', handleSubmit);
  $('cancelEditBtn').addEventListener('click', () => { resetForm(); });

  $('fAllDay').addEventListener('change', e => { $('fTime').disabled = e.target.checked; });

  $('colorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    selectSwatch(sw.dataset.color);
  });

  $('remindBtn').addEventListener('click', onRemindClick);
  $('muteBtn').addEventListener('click', () => {
    state.muted = !state.muted;
    save();
    $('muteBtn').textContent = state.muted ? '🔇' : '🔊';
    toast(state.muted ? '提示音已关闭' : '提示音已开启');
  });

  $('exportBtn').addEventListener('click', exportICS);
  $('importBtn').addEventListener('click', () => $('icsFile').click());
  $('icsFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importICSFile(f); e.target.value = ''; });

  $('backupBtn').addEventListener('click', backupJSON);
  $('restoreBtn').addEventListener('click', () => $('jsonFile').click());
  $('jsonFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) restoreJSONFile(f); e.target.value = ''; });

  // 页面可见时立即检查一次提醒
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
}

/* ---------- PWA / 离线 ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;   // file:// 无法注册
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => resumePushIfAny())
      .catch(e => console.warn('SW 注册失败', e));
  });
}

/* =========================================================
 * Web Push 推送：浏览器关闭也能收到提醒
 * 需要 HTTPS（本机 localhost 除外）。订阅后把“设了提醒的
 * 任务”同步给服务端，由服务端定时推送。
 * ========================================================= */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

/* 任务提醒时间对应的 UTC 毫秒时间戳（服务端据此推送，与时区无关） */
function remindAtEpoch(t) {
  if (!t.time || t.reminder === null || t.reminder === undefined || t.reminder === '') return null;
  const p = t.date.split('-').map(Number);
  const q = t.time.split(':').map(Number);
  return new Date(p[0], p[1] - 1, p[2], q[0], q[1]).getTime() - Number(t.reminder) * 60000;
}

async function pushSync(sub) {
  const tasks = state.tasks.map(t => ({
    id: t.id,
    title: t.title,
    remindAt: remindAtEpoch(t),
    done: !!t.done,
  }));
  await fetch('api/push-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub, tasks }),
  });
}

async function setupPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await fetch('api/vapid-public-key');
      const d = await res.json();
      if (!d.publicKey) return false;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(d.publicKey),
      });
    }
    await pushSync(sub);
    return true;
  } catch (e) {
    console.warn('推送订阅失败', e);
    return false;
  }
}

async function syncCurrentTasks() {
  if (!state.pushReady) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await pushSync(sub);
  } catch (e) { /* 推送同步失败不打扰用户 */ }
}

async function testPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) { toast('推送未订阅，正在重新开启…'); await setupPush(); return; }
    const res = await fetch('api/push-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, title: '彩色日程', body: '这是一条测试推送 ✔' }),
    });
    const d = await res.json();
    if (d.ok) { toast('测试推送已发送，请留意通知栏 ✔'); }
    else if (d.gone) { state.pushReady = false; updatePushUI(); toast('订阅已失效，请重新开启推送'); }
    else { toast('推送发送失败（' + (d.statusCode || '网络错误') + '）'); }
  } catch (e) { toast('测试推送失败：' + e.message); }
}

/* 页面已授权过通知时，静默恢复推送订阅并同步任务 */
async function resumePushIfAny() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      state.pushReady = true;
      updatePushUI();
      await pushSync(sub);
    }
  } catch (e) { /* 静默失败 */ }
}

function updatePushUI() {
  const el = $('pushState');
  if (!el) return;
  el.textContent = state.pushReady ? '📶 推送已开启' : '📶 推送未开启';
  el.classList.toggle('on', state.pushReady);
  el.classList.toggle('off', !state.pushReady);
}

async function onRemindClick() {
  if (state.pushReady) { await testPush(); return; }
  if (!('Notification' in window)) { toast('此浏览器不支持通知'); return; }
  const p = Notification.permission;
  if (p === 'denied') { toast('⚠️ 通知已被浏览器屏蔽，请在地址栏左侧站点设置中开启'); return; }
  if (p !== 'granted') {
    const r = await Notification.requestPermission();
    if (r !== 'granted') { toast('未获得通知权限'); return; }
  }
  const ok = await setupPush();
  if (ok) {
    state.pushReady = true;
    updatePushUI();
    toast('✔ 推送已开启：到点即使不打开页面也会收到通知');
  } else {
    toast('⚠️ 推送需要 HTTPS 访问（电脑上 localhost 也可以）；已开启页内提醒');
  }
}

/* ---------- 启动 ---------- */
function init() {
  load();
  renderSwatches();
  bindEvents();
  resetForm();
  renderCalendar();
  renderDayPanel();
  $('muteBtn').textContent = state.muted ? '🔇' : '🔊';
  updatePushUI();
  setInterval(checkReminders, 15000);   // 每 15 秒检查一次提醒
  checkReminders();
  registerSW();
}

init();
