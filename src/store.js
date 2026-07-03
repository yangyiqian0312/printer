import fs from 'node:fs/promises';
import path from 'node:path';

export class OrderStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.orders = new Map();
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const rows = JSON.parse(raw);

      for (const row of Array.isArray(rows) ? rows : []) {
        if (row.order_id) this.orders.set(row.order_id, row);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  async save() {
    const rows = [...this.orders.values()].sort((a, b) => {
      return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    });

    await fs.writeFile(this.filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  }

  get(orderId) {
    return this.orders.get(orderId);
  }

  list() {
    return [...this.orders.values()];
  }

  async upsert(order) {
    const now = new Date().toISOString();
    const previous = this.orders.get(order.order_id) ?? {};
    const next = {
      ...previous,
      ...order,
      created_at: previous.created_at ?? now,
      updated_at: now
    };

    this.orders.set(next.order_id, next);
    await this.save();
    return next;
  }
}
