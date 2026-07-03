const state = {
  config: null,
  orders: [],
  events: [],
  token: localStorage.getItem('labelPrinterToken') || ''
};

const $ = (selector) => document.querySelector(selector);

async function requestJson(url, options) {
  const { skipAuth, ...fetchOptions } = options || {};
  const headers = new Headers(fetchOptions.headers || {});

  if (state.token && !skipAuth) {
    headers.set('authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('labelPrinterToken');
      state.token = '';
    }
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function setService(ok) {
  $('#serviceDot').className = ok ? 'dot ok' : 'dot bad';
  $('#serviceStatus').textContent = ok ? 'Service online' : 'Service offline';
}

function renderConfig() {
  const config = state.config;
  if (!config) return;

  $('#webhookUrl').textContent = config.webhookUrl;
  $('#printerName').textContent = config.printerName || 'Windows agent';
  $('#printMode').textContent = config.role === 'server' ? 'Queued for Windows agent' : config.autoPrint ? 'Auto print enabled' : 'Test mode, PDF only';
  $('#labelSize').textContent = `${config.labelWidth} x ${config.labelHeight}`;
}

function renderStats(stats) {
  $('#statTotal').textContent = stats.total ?? 0;
  $('#statPrinted').textContent = stats.printed ?? 0;
  $('#statGenerated').textContent = stats.generated ?? 0;
  $('#statFailed').textContent = stats.failed ?? 0;
}

function renderOrders() {
  const body = $('#ordersBody');

  if (!state.orders.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No orders yet</td></tr>';
    return;
  }

  body.innerHTML = state.orders
    .map((order) => {
      const canRetry = order.status === 'failed';
      return `
        <tr>
          <td>${escapeHtml(order.order_id)}</td>
          <td>${escapeHtml(order.buyer_username)}</td>
          <td><span class="pill ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
          <td>${escapeHtml(formatTime(order.updated_at))}</td>
          <td>${escapeHtml(order.error_message || '')}</td>
          <td>${canRetry ? `<button data-retry="${escapeHtml(order.order_id)}" type="button">Retry</button>` : ''}</td>
        </tr>
      `;
    })
    .join('');
}

function renderEvents() {
  const list = $('#eventsList');

  if (!state.events.length) {
    list.innerHTML = '<p class="empty">No webhook events yet</p>';
    return;
  }

  list.innerHTML = state.events
    .slice(0, 8)
    .map((event) => {
      const title = `${event.status || 'received'} ${event.order_id ? `- ${event.order_id}` : ''}`;
      return `
        <article class="event-card">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(formatTime(event.received_at))}</span>
          <code>${escapeHtml(JSON.stringify(event.body ?? {}, null, 2))}</code>
        </article>
      `;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refresh() {
  try {
    const [health, config] = await Promise.all([
      requestJson('/health'),
      requestJson('/api/config', { skipAuth: true })
    ]);

    state.config = config;

    if (config.appTokenEnabled && !state.token) {
      const token = window.prompt('Enter app token');
      if (token) {
        state.token = token.trim();
        localStorage.setItem('labelPrinterToken', state.token);
      }
    }

    const [stats, orders, events] = await Promise.all([
      requestJson('/api/stats'),
      requestJson('/api/orders'),
      requestJson('/api/webhook-events')
    ]);

    setService(Boolean(health.ok));
    state.orders = orders;
    state.events = events;
    renderConfig();
    renderStats(stats);
    renderOrders();
    renderEvents();
  } catch (error) {
    setService(false);
    $('#formResult').textContent = error.message;
  }
}

$('#printForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    buyerUsername: form.get('buyerUsername'),
    orderId: form.get('orderId')
  };

  $('#formResult').textContent = 'Sending label...';

  try {
    const result = await requestJson('/api/print-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    $('#formResult').textContent = result.skipped ? 'Duplicate skipped.' : 'Label accepted.';
    await refresh();
  } catch (error) {
    $('#formResult').textContent = error.message;
  }
});

$('#ordersBody').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-retry]');
  if (!button) return;

  button.disabled = true;
  button.textContent = 'Retrying';

  try {
    await requestJson(`/api/orders/${encodeURIComponent(button.dataset.retry)}/retry`, {
      method: 'POST'
    });
    await refresh();
  } catch (error) {
    $('#formResult').textContent = error.message;
  }
});

$('#copyWebhook').addEventListener('click', async () => {
  if (!state.config?.webhookUrl) return;
  await navigator.clipboard.writeText(state.config.webhookUrl);
  $('#copyWebhook').textContent = 'Copied';
  setTimeout(() => {
    $('#copyWebhook').textContent = 'Copy';
  }, 1200);
});

$('#refresh').addEventListener('click', refresh);

refresh();
setInterval(refresh, 8000);
