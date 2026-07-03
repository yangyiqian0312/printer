import dotenv from 'dotenv';

dotenv.config();

export const serverConfig = {
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || '',
  appToken: process.env.APP_TOKEN?.trim() || '',
  agentToken: process.env.AGENT_TOKEN?.trim() || '',
  webhookSecret: process.env.TIKTOK_WEBHOOK_SECRET?.trim() || '',
  databasePath: process.env.DATABASE_PATH || './data/server-db.json'
};
