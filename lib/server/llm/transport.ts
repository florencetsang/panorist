/** fetch with a per-attempt timeout and bounded retries. Provider-agnostic. */

import { sleep } from '../util/async.ts';

export interface RetryOptions {
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Retries after the first attempt. */
  maxRetries: number;
  /** Backoff before retry n (1-based) is backoffBaseMs * 4^(n-1). */
  backoffBaseMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  // Search-grounded summaries can take a minute.
  timeoutMs: 90_000,
  maxRetries: 2,
  backoffBaseMs: 1_000,
};

/** Truncate long strings for error messages and logs. */
export const snippet = (s: string, max = 300): string =>
  s.length > max ? `${s.slice(0, max)}…` : s;

class RetryableError extends Error {}
class FatalError extends Error {}

// AbortSignal.timeout() rejects with a DOMException, which isn't an Error
// subclass in every runtime — match on name.
const isTimeout = (err: unknown): boolean => {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : null;
  return name === 'TimeoutError' || name === 'AbortError';
};

/**
 * Retries 429, 5xx and network errors. Other HTTP errors fail immediately.
 * Timeouts are not retried: a call that timed out once will likely do so
 * again and only burn the caller's time budget.
 */
export async function fetchTextWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<string> {
  let lastError: Error = new Error(`request failed: ${url}`);
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (attempt > 0) await sleep(options.backoffBaseMs * 4 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const text = await response.text();
      if (response.ok) return text;
      const message = `LLM endpoint returned HTTP ${response.status}: ${snippet(text)}`;
      if (response.status === 429 || response.status >= 500) throw new RetryableError(message);
      throw new FatalError(message);
    } catch (err) {
      if (err instanceof FatalError) throw err;
      if (isTimeout(err)) {
        throw new Error(`LLM request timed out after ${options.timeoutMs / 1000}s: ${url}`);
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}
