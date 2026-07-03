import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { serverConfig } from './config.js';
import { QueueStore } from './queueStore.js';
import { expandNestedJson, normalizeOrder } from '../shared/orderMapping.js';
import { logger } from '../shared/logger.js';

const app = express();
const queue = new QueueStore(serverConfig.databasePath);
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

function safeEqual(a, b) {
  const left = Buffer.from(a ?? '');
  const right = Buffer.from(b ?? '');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyAppToken(req, res, next) {
  if (!serverConfig.appToken) return next();

  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-app-token');
  if (safeEqual(token, serverConfig.appToken)) return next();

  return res.status(401).json({ ok: false, error: 'App token required' });
}

function verifyAgentToken(req, res, next) {
  if (!serverConfig.agentToken) return next();

  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-agent-token');
  if (safeEqual(token, serverConfig.agentToken)) return next();

  return res.status(401).json({ ok: false, error: 'Agent token required' });
}

function verifyWebhookSecret(req) {
  if (!serverConfig.webhookSecret) return true;
  return safeEqual(req.get('x-webhook-secret') ?? '', serverConfig.webhookSecret);
}

function collectWebhookHeaders(req) {
  const interesting = [
    'user-agent',
    'content-type',
    'x-tts-signature',
    'x-tts-timestamp',
    'x-tts-nonce',
    'x-webhook-secret'
  ];

  return Object.fromEntries(interesting.map((name) => [name, req.get(name)]).filter(([, value]) => value));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, role: 'server' });
});

app.get('/api/config', (_req, res) => {
  const baseUrl = serverConfig.publicBaseUrl || `http://localhost:${serverConfig.port}`;

  res.json({
    role: 'server',
    port: serverConfig.port,
    publicBaseUrl: serverConfig.publicBaseUrl,
    webhookUrl: `${baseUrl.replace(/\/$/, '')}/webhook/tiktok`,
    printerName: 'Handled by Windows agent',
    autoPrint: false,
    labelWidth: '2in',
    labelHeight: '1in',
    databasePath: serverConfig.databasePath,
    appTokenEnabled: Boolean(serverConfig.appToken),
    agentTokenEnabled: Boolean(serverConfig.agentToken),
    webhookSecretEnabled: Boolean(serverConfig.webhookSecret)
  });
});

app.use('/api', verifyAppToken);

app.get('/api/orders', async (_req, res) => {
  await queue.ready();
  res.json(queue.listOrders());
});

app.get('/api/stats', async (_req, res) => {
  await queue.ready();
  res.json(queue.stats());
});

app.get('/api/webhook-events', async (_req, res) => {
  await queue.ready();
  res.json(queue.listWebhookEvents());
});

app.post('/api/print-label', async (req, res, next) => {
  try {
    const order = normalizeOrder(req.body);
    const result = await queue.createOrUpdateOrder({
      orderId: order.orderId,
      buyerUsername: order.buyerUsername,
      source: 'manual',
      payload: req.body
    });

    logger.info('Manual print job queued', { order_id: order.orderId, created: result.created });
    res.status(result.created ? 201 : 200).json({ ok: true, skipped: !result.created, order: result.order });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/:orderId/retry', async (req, res) => {
  const order = await queue.retryOrder(req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order });
});

app.get('/agent/jobs/next', verifyAgentToken, async (req, res) => {
  const agentId = req.get('x-agent-id') || 'windows-agent';
  const job = await queue.claimNext({ agentId });

  res.json({
    ok: true,
    job
  });
});

app.post('/agent/jobs/:jobId/printed', verifyAgentToken, async (req, res) => {
  const agentId = req.get('x-agent-id') || req.body?.agentId || 'windows-agent';
  const order = await queue.markPrinted(req.params.jobId, {
    agentId,
    labelPath: req.body?.labelPath
  });

  if (!order) return res.status(404).json({ ok: false, error: 'Job not found' });
  res.json({ ok: true, order });
});

app.post('/agent/jobs/:jobId/failed', verifyAgentToken, async (req, res) => {
  const agentId = req.get('x-agent-id') || req.body?.agentId || 'windows-agent';
  const order = await queue.markFailed(req.params.jobId, {
    agentId,
    errorMessage: req.body?.errorMessage
  });

  if (!order) return res.status(404).json({ ok: false, error: 'Job not found' });
  res.json({ ok: true, order });
});

app.post('/webhook/tiktok', async (req, res, next) => {
  try {
    if (!verifyWebhookSecret(req)) {
      return res.status(401).end();
    }

    const expandedBody = expandNestedJson(req.body);
    let order;

    try {
      order = normalizeOrder(expandedBody);
    } catch (error) {
      const event = await queue.appendWebhookEvent({
        source: 'tiktok',
        status: 'received_unmapped',
        method: req.method,
        path: req.originalUrl,
        headers: collectWebhookHeaders(req),
        body: expandedBody,
        raw_body: req.rawBody ?? '',
        note: error.message
      });

      logger.warn('TikTok webhook received but not mapped', { event_id: event.id, error: error.message });
      return res.status(200).end();
    }

    const event = await queue.appendWebhookEvent({
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

    const result = await queue.createOrUpdateOrder({
      orderId: order.orderId,
      buyerUsername: order.buyerUsername,
      source: 'tiktok',
      payload: expandedBody
    });

    logger.info('TikTok print job queued', {
      event_id: event.id,
      order_id: order.orderId,
      created: result.created
    });

    res.status(200).end();
  } catch (error) {
    next(error);
  }
});

app.get('/webhook/tiktok', (req, res) => {
  const challenge = req.query.challenge ?? req.query.verify_token ?? req.query.echostr;
  if (challenge) return res.type('text/plain').send(String(challenge));
  res.json({ ok: true, endpoint: 'tiktok-webhook' });
});

app.options('/webhook/tiktok', (_req, res) => {
  res.set('allow', 'GET,POST,OPTIONS').status(204).send();
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode ?? 500;
  res.status(statusCode).json({ ok: false, error: error.message, order: error.order });
});

await queue.ready();

const server = app.listen(serverConfig.port, '0.0.0.0', () => {
  logger.info('TikTok label server started', {
    port: serverConfig.port,
    database_path: serverConfig.databasePath,
    agent_token_configured: Boolean(serverConfig.agentToken)
  });
});

server.on('error', (error) => {
  logger.error('Server failed', { error: error.message });
  process.exitCode = 1;
});
