import fs from 'node:fs/promises';
import path from 'node:path';

export class WebhookEventStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.events = [];
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const rows = JSON.parse(raw);
      this.events = Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  async save() {
    const recent = this.events.slice(-200);
    await fs.writeFile(this.filePath, `${JSON.stringify(recent, null, 2)}\n`, 'utf8');
  }

  list() {
    return [...this.events].reverse();
  }

  async append(event) {
    await this.ready;

    const next = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      received_at: new Date().toISOString(),
      ...event
    };

    this.events.push(next);
    await this.save();
    return next;
  }
}
