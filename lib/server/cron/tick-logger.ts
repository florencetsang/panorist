/**
 * Per-tick logger. Lines always go to the console; when capture is enabled
 * (CRON_DB_LOGS) they're also kept, timestamped, for cron_runs.logs.
 */

import { errorMessage } from '../util/errors.ts';

export interface TickLogger {
  log(message: string): void;
  error(message: string, err?: unknown): void;
  /** Captured lines joined, or null when capture is off or empty. */
  text(): string | null;
}

export function createTickLogger(capture: boolean, now: () => Date = () => new Date()): TickLogger {
  const lines: string[] = [];
  const record = (message: string): void => {
    if (capture) lines.push(`${now().toISOString().slice(11, 23)} ${message}`);
  };
  return {
    log(message) {
      console.log(message);
      record(message);
    },
    error(message, err) {
      if (err === undefined) console.error(message);
      else console.error(message, err);
      // One line per error in the DB; the console keeps the full stack.
      record(err === undefined ? message : `${message}: ${errorMessage(err)}`);
    },
    text() {
      return lines.length > 0 ? lines.join('\n') : null;
    },
  };
}
