import { agentConfig } from './config.js';
import { createLabelPdf } from '../shared/label.js';
import { logger } from '../shared/logger.js';
import { printPdf } from '../shared/printer.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serverRequest(path, options = {}) {
  if (!agentConfig.agentToken) {
    throw new Error('AGENT_TOKEN is required for the Windows print agent');
  }

  const response = await fetch(`${agentConfig.serverUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${agentConfig.agentToken}`,
      'x-agent-id': agentConfig.agentId,
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Server request failed: ${response.status}`);
  }

  return body;
}

async function markPrinted(job, labelPath) {
  await serverRequest(`/agent/jobs/${encodeURIComponent(job.id)}/printed`, {
    method: 'POST',
    body: JSON.stringify({
      agentId: agentConfig.agentId,
      labelPath
    })
  });
}

async function markFailed(job, error) {
  await serverRequest(`/agent/jobs/${encodeURIComponent(job.id)}/failed`, {
    method: 'POST',
    body: JSON.stringify({
      agentId: agentConfig.agentId,
      errorMessage: error.message
    })
  });
}

async function printJob(job) {
  const labelPath = await createLabelPdf({
    orderId: job.order_id,
    buyerUsername: job.buyer_username,
    outputDir: agentConfig.labelOutputDir,
    widthPt: agentConfig.labelWidthPt,
    heightPt: agentConfig.labelHeightPt
  });

  if (agentConfig.dryRun) {
    logger.info('Agent dry run generated label', {
      job_id: job.id,
      order_id: job.order_id,
      label_path: labelPath
    });
  } else {
    await printPdf(labelPath, agentConfig.printerName);
    logger.info('Agent printed label', {
      job_id: job.id,
      order_id: job.order_id,
      printer: agentConfig.printerName ?? 'default',
      label_path: labelPath
    });
  }

  await markPrinted(job, labelPath);
}

async function pollOnce() {
  const { job } = await serverRequest('/agent/jobs/next');
  if (!job) return false;

  logger.info('Agent claimed job', {
    job_id: job.id,
    order_id: job.order_id,
    buyer_username: job.buyer_username
  });

  try {
    await printJob(job);
  } catch (error) {
    logger.error('Agent print failed', {
      job_id: job.id,
      order_id: job.order_id,
      error: error.message
    });

    await markFailed(job, error);
  }

  return true;
}

logger.info('Windows print agent started', {
  server_url: agentConfig.serverUrl,
  agent_id: agentConfig.agentId,
  printer: agentConfig.printerName ?? 'default',
  dry_run: agentConfig.dryRun,
  poll_interval_ms: agentConfig.pollIntervalMs
});

while (true) {
  try {
    const hadJob = await pollOnce();
    await sleep(hadJob ? 250 : agentConfig.pollIntervalMs);
  } catch (error) {
    logger.error('Agent poll failed', { error: error.message });
    await sleep(agentConfig.pollIntervalMs);
  }
}
