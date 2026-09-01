# 彩色日程 · 规划小助手

一个本地运行的网页日历应用（PWA）：
- 🎨 **8 种颜色**标记每天要做的事（工作蓝 / 生活绿 / 学习橙 / 重要红 / 浪漫紫 / 健康青 / 运动橙 / 沉稳灰）
- 📅 **日历同步**：一键导出 `.ics` 文件，可导入 iPhone 日历、Google 日历、Outlook、企业微信等；也支持从 `.ics` 导入
- ⏰ **提醒双通道**：
  - **Web Push 推送**：浏览器/应用完全关着也能收到（需要 HTTPS 访问，见下）
  - **页内提醒**：页面打开时弹系统通知 + 提示音（可静音）
- 💾 数据保存在浏览器本地（localStorage），支持 JSON 备份/恢复
- 📱 支持“添加到主屏幕”以 App 方式使用，离线可用

## 如何启动

```powershell
cd "D:\deepseek harness工作区\schedule-planner"
node server.js        # 或双击 start.bat
```

然后浏览器打开 <http://127.0.0.1:8123/>。
（首次启动会自动生成 VAPID 密钥 `vapid-keys.json`，并创建推送订阅数据库 `push-data.json`。）

## ⏰ Web Push 推送提醒（重点）

### 原理
1. 打开应用 → 点右上角「🔔 提醒」→ 允许通知权限 → 自动向浏览器订阅推送（`PushManager`）。
2. 设了提醒的任务会**自动同步到服务端**；之后新增/编辑/删除/完成任务都会自动重新同步。
3. 服务端每 20 秒检查一次，到点（提前 N 分钟）通过浏览器厂商推送服务把通知发到你的设备——
   **应用没开、浏览器关着都能收到**。点击通知可直接回到应用。

### ⚠️ 硬性前提：必须 HTTPS（`localhost` 例外）
`PushManager` 只在**安全上下文**可用：`https://` 或本机 `http://localhost`。
- **电脑本机**：直接访问 `http://127.0.0.1:8123/` 即可开启推送 ✅
- **手机同 Wi-Fi**（`http://192.168.10.13:8123/`）：**无法**开启推送（非 https），只能页内提醒。
  想要手机推送，用下面任一 HTTPS 方案：

**方案 A · 免费云部署（推荐，随时随地可用）**
把 `server.js`（整个文件夹）部署到支持 Node 的免费平台，例如 Render：
1. 把本文件夹推到 GitHub 仓库。
2. 在 <https://render.com> 新建 Web Service，连上该仓库，启动命令 `node server.js`，实例类型选 Free。
3. 把本机生成的 `vapid-keys.json` 内容分别填入环境变量 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`
   （否则重启后密钥会变、订阅失效），`VAPID_SUBJECT` 可填你的邮箱。
4. 得到 `https://xxx.onrender.com` → 手机打开 → 添加到主屏幕 → 开「🔔 提醒」→ 推送全平台可用，
   且无需电脑开机。

**方案 B · 家里临时 HTTPS 隧道（免费、不部署）**
1. 下载 <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/> 的 `cloudflared.exe`。
2. 运行：`cloudflared tunnel --url http://127.0.0.1:8123`，会得到一个 `https://xxx.trycloudflare.com` 地址。
3. 手机打开该地址使用（需电脑开着、隧道开着）。此地址每次重启会变。

### 使用小贴士
- 已开启推送后，再点「🔔 提醒」会**发送一条测试推送**，方便验证。
- 顶部状态标签会显示「📶 推送已开启 / 推送未开启」。
- iOS Safari 需要 iOS 16.4+，且必须先把应用**添加到主屏幕**才支持推送。
- 页内提醒与推送到点可能各响一次，属正常（双保险）。

## 📱 在手机上使用（不使用推送时）

**同一 Wi-Fi 局域网访问（免费，最方便）**

1. 电脑和手机连**同一个 Wi-Fi**。
2. 双击 `allow-firewall.bat`（第一次弹 UAC 授权，点“是”），放行 8123 端口。
3. 手机浏览器打开 `http://192.168.10.13:8123/`（IP 变化时用 `ipconfig | findstr IPv4` 查）。
4. 像 App 一样用：iPhone Safari「分享 → 添加到主屏幕」；Android Chrome「菜单 → 添加到主屏幕 / 安装应用」。

**随时随地用**：见上面「方案 A」部署 Render，或把静态部分拖到 <https://app.netlify.com/drop>
（纯静态托管无推送，只有页内提醒）。

## 使用说明

1. **添加任务**：点击日历某天 → 右侧填写内容 → 选择时间（勾选“全天”则不留时间）→ 挑颜色 → 选提醒 → 添加。
2. **完成/编辑/删除**：勾选框标记完成；✎ 编辑；🗑 删除。
3. **同步日历**：右上角「⬇ 导出 .ics」→ iPhone 用“文件”App 打开加入日历；Google 日历“导入日历”；Outlook“打开”。
   设了提醒的任务导出时附带提醒（VALARM）。「⬆ 导入 .ics」可把外部日历日程导入，重复自动跳过。
4. **备份/恢复**：右上角「💾 备份」保存 JSON，「♻ 恢复」覆盖恢复。
   （推送服务端不存你的完整日程，只存“设了提醒的任务+时间戳”，隐私友好。）

## 目录结构

```
schedule-planner/
├─ index.html           页面
├─ css/style.css        样式
├─ js/app.js            日历/任务/提醒/推送客户端逻辑
├─ js/ics.js            .ics 导入导出
├─ server.js            静态服务器 + 推送 API（Node）
├─ push.js              Web Push 服务端：VAPID、订阅存储、定时调度
├─ sw.js                离线缓存 + push 事件接收
├─ manifest.webmanifest PWA 清单
├─ icons/               应用图标
├─ vapid-keys.json      推送密钥（首次启动自动生成；云端部署改填环境变量）
├─ push-data.json       推送订阅数据库（自动生成）
├─ node_modules/        web-push 依赖（npm install 生成）
├─ allow-firewall.bat/.ps1  放行防火墙端口
├─ start.bat            一键启动
└─ README.md
```

## 数据存储

- 日程数据：浏览器 `localStorage`（key: `schedule-planner-data-v1`），清理浏览器数据会清空，请定期备份。
- 推送数据：`push-data.json`（只含订阅和提醒时间戳）。删除它不影响日程，只需在应用里重新点一次「🔔 提醒」。
