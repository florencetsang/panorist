/** Request/response helpers shared by the API route handlers. */

import 'server-only';

import { isPlainObject } from '../shared/validation.ts';

/**
 * Uniform JSON error response. Messages must be static strings — never raw
 * error objects — so provider URLs, keys or secrets can't leak.
 */
export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Parse a JSON object body; null for invalid JSON or a non-object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isPlainObject(body) ? body : null;
  } catch {
    return null;
  }
}
