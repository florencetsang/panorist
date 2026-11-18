import { readFileSync } from 'node:fs';

/**
 * Minimal dotenv loader: KEY=value lines, optional `export`, optional quotes.
 * Existing environment variables win, so call it for the highest-priority
 * file first.
 */
export function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] ??= value;
  }
}
