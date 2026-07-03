import dotenv from 'dotenv';

dotenv.config();

function parseLabelSize(value, fallbackInches) {
  if (!value) return fallbackInches * 72;

  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^([0-9]*\.?[0-9]+)\s*(in|inch|inches|mm|pt)?$/);

  if (!match) {
    throw new Error(`Invalid label size: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'in';

  if (unit === 'mm') return (amount / 25.4) * 72;
  if (unit === 'pt') return amount;
  return amount * 72;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || '',
  appToken: process.env.APP_TOKEN?.trim() || '',
  printerName: process.env.PRINTER_NAME?.trim() || undefined,
  labelWidthPt: parseLabelSize(process.env.LABEL_WIDTH, 2),
  labelHeightPt: parseLabelSize(process.env.LABEL_HEIGHT, 1),
  databasePath: process.env.DATABASE_PATH || './data/orders.json',
  webhookEventsPath: process.env.WEBHOOK_EVENTS_PATH || './data/webhook-events.json',
  labelOutputDir: process.env.LABEL_OUTPUT_DIR || './data/labels',
  webhookSecret: process.env.TIKTOK_WEBHOOK_SECRET || '',
  autoPrint: String(process.env.AUTO_PRINT ?? 'true').toLowerCase() !== 'false'
};
