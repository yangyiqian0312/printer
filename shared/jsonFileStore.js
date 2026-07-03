import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonFileStore {
  constructor(filePath, fallbackValue) {
    this.filePath = path.resolve(filePath);
    this.value = fallbackValue;
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.value = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(this.filePath, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8');
  }
}
