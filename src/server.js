import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { createLabelPdf } from './label.js';
import { logger } from './logger.js';
import { printPdf, listPrinters } from './printer.js';
import { OrderStore } from './store.js';
import { WebhookEventStore } from './webhookEvents.js';

const app = express();
const store = new OrderStore(config.databasePath);
const webhookEvents = new WebhookEventStore(config.webhookEventsPath);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');

function captureRawBody(req, _res, buffer) {
  req.rawBody = buffer.toString('utf8');
}

app.use(
  express.json({
    limit: '1mb',
    type: ['application/json', 'application/*+json'],
    verify: captureRawBody
  })
);
app.use(
  express.text({
    limit: '1mb',
    type: ['text/*', 'application/octet-stream'],
    verify: captureRawBody
  })
);
app.use(express.static(publicDir));

function verifyAppToken(req, res, next) {
  if (!config.appToken) return next();

  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-app-token');

  if (token === config.appToken) return next();

  return res.status(401).json({
    ok: false,
    error: 'App token required'
  });
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function expandNestedJson(value, depth = 0) {
  if (depth > 4) return value;

  const parsed = parseMaybeJson(value);

  if (Array.isArray(parsed)) {
    return parsed.map((item) => expandNestedJson(item, depth + 1));
  }

  if (parsed && typeof parsed === 'object') {
    return Object.fromEntries(
      Object.entries(parsed).map(([key, entry]) => [key, expandNestedJson(entry, depth + 1)])
    );
  }

  return parsed;
}

function findDeepValue(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue = [value];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const [key, entry] of Object.entries(current)) {
      if (wanted.has(key.toLowerCase()) && entry !== undefined && entry !== null && String(entry).trim()) {
        return entry;
      }

      if (entry && typeof entry === 'object') queue.push(entry);
    }
  }

  return undefined;
}

function collectWebhookHeaders(req) {
  const interesting = [
    'user-agent',
    'content-type',
    'x-tts-signature',
    'x-tts-timestamp',
    'x-tts-nonce',
    'x-shopify-hmac-sha256',
    'x-webhook-secret'
  ];

  return Object.fromEntries(
    interesting
      .map((name) => [name, req.get(name)])
      .filter(([, value]) => value)
  );
}

function normalizeOrder(body) {
  const expanded = expandNestedJson(body);
  const orderId =
    expanded?.orderId ??
    expanded?.order_id ??
    expanded?.id ??
    findDeepValue(expanded, [
      'orderId',
      'order_id',
      'order_id_str',
      'order_sn',
      'orderNo',
      'order_no',
      'orderNumber',
      'order_number'
    ]);
  const buyerUsername =
    expanded?.buyerUsername ??
    expanded?.buyer_username ??
    expanded?.buyer?.username ??
    expanded?.recipient_address?.name ??
    findDeepValue(expanded, [
      'buyerUsername',
      'buyer_username',
      'buyer_user_name',
      'username',
      'user_name',
      'buyer_id',
      'buyerId',
      'recipient_name',
      'recipientName',
      'name'
    ]);

  if (!orderId || !buyerUsername) {
    const error = new Error('Missing orderId or buyerUsername');
    error.statusCode = 400;
    throw error;
  }

  return {
    orderId: String(orderId).trim(),
    buyerUsername: String(buyerUsername).trim()
  };
}

function verifyWebhookSecret(req) {
  if (!config.webhookSecret) return true;

  const provided = Buffer.from(req.get('x-webhook-secret') ?? '');
  const expected = Buffer.from(config.webhookSecret);

  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

async function handlePrint({ orderId, buyerUsername, force = false }) {
  await store.ready;

  const existing = store.get(orderId);
  const alreadyHandled = existing?.status === 'printed' || (!config.autoPrint && existing?.status === 'generated');

  if (alreadyHandled && !force) {
    logger.info('Duplicate order skipped', { order_id: orderId, buyer_username: buyerUsername });
    return {
      skipped: true,
      order: existing
    };
  }

  const recordBase = {
    order_id: orderId,
    buyer_username: buyerUsername,
    status: config.autoPrint ? 'pending' : 'generated',
    error_message: '',
    printed_at: existing?.printed_at ?? null
  };

  await store.upsert(recordBase);

  try {
    const pdfPath = await createLabelPdf({
      orderId,
      buyerUsername,
      outputDir: config.labelOutputDir,
      widthPt: config.labelWidthPt,
      heightPt: config.labelHeightPt
    });

    if (config.autoPrint) {
      await printPdf(pdfPath, config.printerName);
    }

    const printedRecord = await store.upsert({
      ...recordBase,
      label_path: pdfPath,
      status: config.autoPrint ? 'printed' : 'generated',
      printed_at: config.autoPrint ? new Date().toISOString() : null,
      error_message: ''
    });

    logger.info(config.autoPrint ? 'Label printed' : 'Label generated', {
      order_id: orderId,
      buyer_username: buyerUsername,
      printer: config.printerName ?? 'default',
      label_path: pdfPath
    });

    return {
      skipped: false,
      order: printedRecord
    };
  } catch (error) {
    const failedRecord = await store.upsert({
      ...recordBase,
      status: 'failed',
      error_message: error.message
    });

    logger.error('Label print failed', {
      order_id: orderId,
      buyer_username: buyerUsername,
      error: error.message
    });

    throw Object.assign(error, { order: failedRecord });
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  const baseUrl = config.publicBaseUrl || `http://localhost:${config.port}`;

  res.json({
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    webhookUrl: `${baseUrl.replace(/\/$/, '')}/webhook/tiktok`,
    printerName: config.printerName ?? '',
    autoPrint: config.autoPrint,
    labelWidth: process.env.LABEL_WIDTH ?? '2in',
    labelHeight: process.env.LABEL_HEIGHT ?? '1in',
    databasePath: config.databasePath,
    appTokenEnabled: Boolean(config.appToken),
    webhookSecretEnabled: Boolean(config.webhookSecret)
  });
});

app.use('/api', verifyAppToken);

app.get('/printers', verifyAppToken, async (_req, res, next) => {
  try {
    res.json(await listPrinters());
  } catch (error) {
    next(error);
  }
});

app.get('/orders', verifyAppToken, async (_req, res) => {
  await store.ready;
  res.json(store.list());
});

app.get('/api/orders', async (_req, res) => {
  await store.ready;
  res.json(store.list());
});

app.get('/api/webhook-events', async (_req, res) => {
  await webhookEvents.ready;
  res.json(webhookEvents.list());
});

app.get('/api/stats', async (_req, res) => {
  await store.ready;
  const orders = store.list();

  res.json({
    total: orders.length,
    printed: orders.filter((order) => order.status === 'printed').length,
    generated: orders.filter((order) => order.status === 'generated').length,
    failed: orders.filter((order) => order.status === 'failed').length,
    pending: orders.filter((order) => order.status === 'pending').length
  });
});

app.post('/print-label', verifyAppToken, async (req, res, next) => {
  try {
    const order = normalizeOrder(req.body);
    const result = await handlePrint(order);

    res.status(200).json({
      ok: true,
      skipped: result.skipped,
      order: result.order
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/print-label', async (req, res, next) => {
  try {
    const order = normalizeOrder(req.body);
    const result = await handlePrint(order);

    res.status(result.skipped ? 200 : 201).json({
      ok: true,
      skipped: result.skipped,
      order: result.order
    });
  } catch (error) {
    next(error);
  }
});

app.post('/orders/:orderId/retry', verifyAppToken, async (req, res, next) => {
  try {
    await store.ready;

    const existing = store.get(req.params.orderId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const result = await handlePrint({
      orderId: existing.order_id,
      buyerUsername: existing.buyer_username,
      force: true
    });

    res.json({ ok: true, order: result.order });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/:orderId/retry', async (req, res, next) => {
  try {
    await store.ready;

    const existing = store.get(req.params.orderId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const result = await handlePrint({
      orderId: existing.order_id,
      buyerUsername: existing.buyer_username,
      force: true
    });

    res.json({ ok: true, order: result.order });
  } catch (error) {
    next(error);
  }
});

app.post('/webhook/tiktok', async (req, res, next) => {
  try {
    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
    }

    const expandedBody = expandNestedJson(req.body);
    let order;
    try {
      order = normalizeOrder(expandedBody);
    } catch (error) {
      const event = await webhookEvents.append({
        source: 'tiktok',
        status: 'received_unmapped',
        method: req.method,
        path: req.originalUrl,
        headers: collectWebhookHeaders(req),
        body: expandedBody,
        raw_body: req.rawBody ?? '',
        note: error.message
      });

      logger.warn('TikTok webhook received but could not be mapped to an order', {
        event_id: event.id,
        error: error.message
      });

      return res.status(200).json({
        ok: true,
        code: 0,
        message: 'success',
        received: true,
        printed: false,
        reason: 'Webhook received but order fields are not mapped yet',
        eventId: event.id
      });
    }

    await webhookEvents.append({
      source: 'tiktok',
      status: 'mapped',
      order_id: order.orderId,
      buyer_username: order.buyerUsername,
      method: req.method,
      path: req.originalUrl,
      headers: collectWebhookHeaders(req),
      body: expandedBody,
      raw_body: req.rawBody ?? ''
    });

    const result = await handlePrint(order);

    res.status(result.skipped ? 200 : 201).json({
      ok: true,
      code: 0,
      message: 'success',
      skipped: result.skipped,
      order: result.order
    });
  } catch (error) {
    next(error);
  }
});

app.get('/webhook/tiktok', (req, res) => {
  const challenge = req.query.challenge ?? req.query.verify_token ?? req.query.echostr;

  if (challenge) {
    return res.type('text/plain').send(String(challenge));
  }

  res.json({ ok: true, endpoint: 'tiktok-webhook' });
});

app.options('/webhook/tiktok', (_req, res) => {
  res.set('allow', 'GET,POST,OPTIONS').status(204).send();
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode ?? 500;

  res.status(statusCode).json({
    ok: false,
    error: error.message,
    order: error.order
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info('TikTok Live label printer service started', {
    port: config.port,
    printer: config.printerName ?? 'default',
    auto_print: config.autoPrint,
    label_width_pt: config.labelWidthPt,
    label_height_pt: config.labelHeightPt
  });
});

server.on('error', (error) => {
  logger.error('Server failed', { error: error.message });
  process.exitCode = 1;
});
