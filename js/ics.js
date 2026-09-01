/* =========================================================
 * 彩色日程 · 日历文件（iCalendar / .ics）导入导出
 * ========================================================= */
'use strict';

/* ---------- 基础工具 ---------- */
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsUnescape(s) {
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\([\\;,])/g, '$1');
}

function pad2(n) { return String(n).padStart(2, '0'); }

function utcStamp() {
  const d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
         'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

/* 生成单个 VEVENT 文本 */
function icsEventText(task) {
  const date = task.date.replace(/-/g, '');
  let lines = [
    'BEGIN:VEVENT',
    'UID:task-' + task.id + '@schedule-planner.local',
    'DTSTAMP:' + utcStamp(),
  ];
  if (task.time) {
    lines.push('DTSTART:' + date + 'T' + task.time.replace(':', ''));
  } else {
    lines.push('DTSTART;VALUE=DATE:' + date);
  }
  lines.push('SUMMARY:' + icsEscape(task.title));
  lines.push('DESCRIPTION:' + icsEscape('来自「彩色日程」规划小助手'));
  if (task.time && task.reminder !== null && task.reminder !== undefined && task.reminder !== '') {
    const min = Number(task.reminder);
    if (min > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT' + min + 'M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:日程提醒');
      lines.push('END:VALARM');
    }
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/* 把任务数组导出为 .ics 字符串 */
function buildICS(tasks) {
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ColorfulSchedule//Planner//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:彩色日程',
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];
  const body = tasks
    .slice()
    .sort((a, b) => (a.date + (a.time || '') ).localeCompare(b.date + (b.time || '')))
    .map(icsEventText);
  return head.concat(body, ['END:VCALENDAR']).join('\r\n') + '\r\n';
}

/* 下载文件 */
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ---------- 导入 .ics ---------- */
function parseICS(text) {
  // 折叠行展开：以空格/制表符开头的行是上一行的续行
  const unfolded = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
  const out = [];

  for (const b of blocks) {
    const field = (name) => {
      const m = b.match(new RegExp('^' + name + '(?:;[^:]*)?:(.*)$', 'im'));
      return m ? m[1].trim() : null;
    };

    const title = icsUnescape(field('SUMMARY') || '未命名任务');
    const startRaw = field('DTSTART');
    if (!startRaw) continue;

    const m = startRaw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/i);
    if (!m) continue;

    let dateStr, timeStr = null;
    if (m[7]) {
      // UTC 时间，转本地
      const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      dateStr = dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
      timeStr = pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
    } else if (m[4] !== undefined) {
      // 本地浮动时间（含 TZID，按本地处理）
      dateStr = m[1] + '-' + m[2] + '-' + m[3];
      timeStr = pad2(+m[4]) + ':' + pad2(+m[5]);
    } else {
      // 全天事件
      dateStr = m[1] + '-' + m[2] + '-' + m[3];
    }

    // 解析 VALARM 触发时间（只取“提前”型）
    let reminder = null;
    const rm = b.match(/TRIGGER:([-+]?)P?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
    if (rm && rm[1] === '-') {
      let mins = 0;
      if (rm[2]) mins += Number(rm[2]) * 1440;
      if (rm[3]) mins += Number(rm[3]) * 60;
      if (rm[4]) mins += Number(rm[4]);
      if (mins > 0) reminder = mins;
    }

    out.push({
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: title,
      date: dateStr,
      time: timeStr,
      allDay: !timeStr,
      color: COLORS[out.length % COLORS.length],
      reminder: reminder,
      done: false,
      source: 'ics',
    });
  }
  return out;
}
