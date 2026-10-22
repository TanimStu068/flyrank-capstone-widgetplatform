import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load the widget source once and derive a content hash used in its public URL. */
export function loadBundle() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'widget.js');
  const source = fs.readFileSync(file, 'utf8');
  return { source, hash: crypto.createHash('sha256').update(source).digest('hex').slice(0, 8) };
}
