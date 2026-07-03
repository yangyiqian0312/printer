import { JsonFileStore } from '../shared/jsonFileStore.js';

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class QueueStore {
  constructor(filePath) {
    this.store = new JsonFileStore(filePath, {
      orders: [],
      webhookEvents: []
    });
  }

  async ready() {
    await this.store.ready;
    this.store.value.orders ??= [];
    this.store.value.webhookEvents ??= [];
  }

  async save() {
    await this.store.save();
  }

  listOrders() {
    return [...this.store.value.orders].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  listWebhookEvents() {
    return [...this.store.value.webhookEvents].reverse();
  }

  stats() {
    const orders = this.store.value.orders;

    return {
      total: orders.length,
      pending: orders.filter((order) => order.status === 'pending').length,
      claimed: orders.filter((order) => order.status === 'claimed').length,
      printed: orders.filter((order) => order.status === 'printed').length,
      failed: orders.filter((order) => order.status === 'failed').length,
      generated: 0
    };
  }

  async appendWebhookEvent(event) {
    await this.ready();

    const row = {
      id: newId('evt'),
      received_at: now(),
      ...event
    };

    this.store.value.webhookEvents.push(row);
    this.store.value.webhookEvents = this.store.value.webhookEvents.slice(-300);
    await this.save();
    return row;
  }

  findOrder(orderId) {
    return this.store.value.orders.find((order) => order.order_id === orderId);
  }

  async createOrUpdateOrder({ orderId, buyerUsername, source = 'manual', payload = null }) {
    await this.ready();

    const existing = this.findOrder(orderId);
    const timestamp = now();

    if (existing) {
      existing.buyer_username = buyerUsername || existing.buyer_username;
      existing.source = source || existing.source;
      existing.raw_payload = payload ?? existing.raw_payload;
      existing.updated_at = timestamp;
      await this.save();
      return { order: existing, created: false };
    }

    const order = {
      id: newId('job'),
      order_id: orderId,
      buyer_username: buyerUsername,
      source,
      status: 'pending',
      attempts: 0,
      error_message: '',
      raw_payload: payload,
      created_at: timestamp,
      updated_at: timestamp,
      claimed_at: null,
      printed_at: null,
      agent_id: null,
      label_path: null
    };

    this.store.value.orders.push(order);
    await this.save();
    return { order, created: true };
  }

  async claimNext({ agentId, staleAfterMs = 120000 }) {
    await this.ready();

    const cutoff = Date.now() - staleAfterMs;
    const candidates = this.store.value.orders
      .filter((order) => {
        if (order.status === 'pending') return true;
        if (order.status !== 'claimed' || !order.claimed_at) return false;
        return new Date(order.claimed_at).getTime() < cutoff;
      })
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    const next = candidates[0];
    if (!next) return null;

    next.status = 'claimed';
    next.attempts = Number(next.attempts ?? 0) + 1;
    next.agent_id = agentId;
    next.claimed_at = now();
    next.updated_at = now();
    next.error_message = '';
    await this.save();
    return next;
  }

  async markPrinted(jobId, { agentId, labelPath }) {
    await this.ready();
    const order = this.store.value.orders.find((row) => row.id === jobId);
    if (!order) return null;

    order.status = 'printed';
    order.agent_id = agentId || order.agent_id;
    order.label_path = labelPath || order.label_path;
    order.printed_at = now();
    order.updated_at = now();
    order.error_message = '';
    await this.save();
    return order;
  }

  async markFailed(jobId, { agentId, errorMessage }) {
    await this.ready();
    const order = this.store.value.orders.find((row) => row.id === jobId);
    if (!order) return null;

    order.status = 'failed';
    order.agent_id = agentId || order.agent_id;
    order.error_message = errorMessage || 'Print failed';
    order.updated_at = now();
    await this.save();
    return order;
  }

  async retryOrder(orderId) {
    await this.ready();
    const order = this.findOrder(orderId);
    if (!order) return null;

    order.status = 'pending';
    order.error_message = '';
    order.claimed_at = null;
    order.updated_at = now();
    await this.save();
    return order;
  }
}
