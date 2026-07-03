# TikTok Live Label Printer

TikTok Shop 出单后，Render 后端接收 webhook，把订单放进打印队列；Windows 电脑上的本地 agent 拉取队列并调用 iDPRT USB 打印机打印 2" x 1" 小标签。

```text
TikTok Shop
  -> Render server /webhook/tiktok
  -> pending print queue
  -> Windows agent
  -> iDPRT USB printer
```

## 项目结构

```text
server/   Render 后端、webhook、网页后台、打印队列 API
agent/    Windows 本地打印客户端
shared/   标签生成、打印、订单字段解析等共用代码
public/   网页后台
src/      旧本地一体化版本，保留作回退测试
```

## 1. 部署 Render Server

Render 使用根目录启动：

```bash
npm install
npm start
```

Render 环境变量参考 `.env.server.example`：

```env
PORT=3000
PUBLIC_BASE_URL=https://your-render-app.onrender.com
APP_TOKEN=change-this-dashboard-password
AGENT_TOKEN=change-this-agent-token
TIKTOK_WEBHOOK_SECRET=
DATABASE_PATH=./data/server-db.json
```

重要变量：

- `PUBLIC_BASE_URL`：Render 给你的固定 HTTPS 地址。
- `APP_TOKEN`：打开网页后台/API 用的密码。
- `AGENT_TOKEN`：Windows agent 连接 Render 用的长密码。
- `TIKTOK_WEBHOOK_SECRET`：先留空，等 webhook 跑通后再加签名/secret。

Render 部署后，网页后台是：

```text
https://your-render-app.onrender.com
```

TikTok webhook URL 是：

```text
https://your-render-app.onrender.com/webhook/tiktok
```

## 2. 配置 TikTok Webhook

在 TikTok Shop Partner / Open Platform 后台找到 webhook / event subscription。

Webhook URL 填：

```text
https://your-render-app.onrender.com/webhook/tiktok
```

事件优先选订单相关：

```text
Order created
Order paid
Order status changed
```

第一次接入时，先看网页后台的 `Webhook Events`。程序会保存 TikTok 发来的原始 payload；如果能找到 `order_id` 和买家字段，会自动创建 pending 打印任务。

## 3. 运行 Windows 打印 Agent

在插 iDPRT 打印机的 Windows 电脑上：

```powershell
Copy-Item .env.agent.example .env.agent
```

编辑 `.env.agent`：

```env
SERVER_URL=https://your-render-app.onrender.com
AGENT_TOKEN=change-this-to-the-same-token-as-render
AGENT_ID=packing-station-1
PRINTER_NAME=
LABEL_WIDTH=2in
LABEL_HEIGHT=1in
LABEL_OUTPUT_DIR=./data/agent-labels
POLL_INTERVAL_MS=3000
AGENT_DRY_RUN=true
```

先用 dry run，不真实打印，只生成 PDF：

```powershell
npm run agent
```

确认 Render 后台订单能从 `pending` 变成 `printed` 后，再改：

```env
AGENT_DRY_RUN=false
```

如果 `PRINTER_NAME` 留空，会使用 Windows 默认打印机。实机打印前，建议先把 iDPRT 设置为默认打印机。

## 4. 手动测试队列

打开 Render 网页后台：

```text
https://your-render-app.onrender.com
```

输入：

```text
buyer123
58392741
```

点 `Send`。这不会在 Render 上打印，而是创建一个打印任务。Windows agent 拉到任务后才会生成标签并打印。

## 5. Windows 开机自启 Agent

注册计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1
```

启动任务：

```powershell
Start-ScheduledTask -TaskName "TikTok Live Label Printer"
```

日志位置：

```text
data\logs\service-out.log
data\logs\service-err.log
```

## 常用命令

```powershell
npm start        # 启动 Render server，本地也可测试 server
npm run agent    # 启动 Windows 打印 agent
npm run local    # 启动旧本地一体化版本
```

## 注意

Render 后端不能直接控制 USB 打印机。自动打印必须由 Windows agent 完成，因为 iDPRT 插在本地电脑上。
