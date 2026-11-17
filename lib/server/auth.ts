/**
 * Shared-secret guard for the internal routes (/api/cron, /api/generate) —
 * they spend LLM budget, so only the scheduler and an admin may call them.
 */

import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { env } from './env.ts';
import { jsonError } from './http.ts';

export type SecretCheck = 'ok' | 'unauthorized' | 'misconfigured';

/** Constant-time comparison; the length of a high-entropy secret is not a meaningful leak. */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

/** Fails closed when CRON_SECRET is unset. */
export function checkCronSecret(provided: string | null): SecretCheck {
  const expected = env.cronSecret();
  if (!expected) return 'misconfigured';
  return provided !== null && secretsMatch(provided, expected) ? 'ok' : 'unauthorized';
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

/** Map a failed check to its response; logs loudly when misconfigured. */
export function secretCheckResponse(check: Exclude<SecretCheck, 'ok'>, route: string): Response {
  if (check === 'misconfigured') {
    console.error(`[${route}] CRON_SECRET is not set — refusing every request`);
    return jsonError(500, 'server misconfigured');
  }
  return jsonError(401, 'unauthorized');
}
