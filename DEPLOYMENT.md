# Deployment Checklist

## Render

Create a Web Service from this repo.

Use:

```text
Build Command: npm install
Start Command: npm start
```

Set environment variables:

```env
PUBLIC_BASE_URL=https://your-render-app.onrender.com
APP_TOKEN=your-dashboard-password
AGENT_TOKEN=your-long-shared-agent-token
TIKTOK_WEBHOOK_SECRET=
DATABASE_PATH=./data/server-db.json
```

TikTok webhook URL:

```text
https://your-render-app.onrender.com/webhook/tiktok
```

## Windows Agent

Create `.env.agent` from `.env.agent.example`:

```env
SERVER_URL=https://your-render-app.onrender.com
AGENT_TOKEN=your-long-shared-agent-token
AGENT_ID=packing-station-1
PRINTER_NAME=
AGENT_DRY_RUN=true
```

Run:

```powershell
npm run agent
```

After dry-run works, set:

```env
AGENT_DRY_RUN=false
```
