import os from 'node:os';
import dotenv from 'dotenv';
import { parseLabelSize } from '../shared/label.js';

dotenv.config({ path: process.env.AGENT_ENV || '.env.agent' });
dotenv.config();

export const agentConfig = {
  serverUrl: process.env.SERVER_URL?.trim()?.replace(/\/$/, '') || 'http://localhost:3000',
  agentToken: process.env.AGENT_TOKEN?.trim() || '',
  agentId: process.env.AGENT_ID?.trim() || `${os.hostname()}-label-agent`,
  printerName: process.env.PRINTER_NAME?.trim() || undefined,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  labelOutputDir: process.env.LABEL_OUTPUT_DIR || './data/agent-labels',
  labelWidthPt: parseLabelSize(process.env.LABEL_WIDTH, 2),
  labelHeightPt: parseLabelSize(process.env.LABEL_HEIGHT, 1),
  dryRun: String(process.env.AGENT_DRY_RUN ?? 'false').toLowerCase() === 'true'
};
