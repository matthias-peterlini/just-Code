import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.js';

const FILE = path.join(CONFIG_DIR, 'history.json');
const MAX = 300;

/** Prompt history, most recent last. Persisted in ~/.just-code/history.json. */
export class PromptHistory {
  items: string[] = [];

  constructor(private file = FILE) {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j)) this.items = j.filter((x) => typeof x === 'string').slice(-MAX);
    } catch {
      /* none yet */
    }
  }

  add(text: string) {
    const t = text.trim();
    if (!t) return;
    this.items = [...this.items.filter((x) => x !== t), t].slice(-MAX);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 });
    } catch {
      /* read-only home */
    }
  }
}
