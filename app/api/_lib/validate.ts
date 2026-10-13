/**
 * Request-shape helpers shared by the API routes.
 *
 * Lives in app/api/_lib — Next.js treats underscore-prefixed folders as
 * private (opted out of routing), so this can never become an endpoint.
 * Pure functions only, safe to import from any route.
 */

import { CATEGORY_SLUGS, type CategorySlug, type PushSubscriptionJSON } from '../../../lib/types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loose uuid check — we only need "can this string be an id at all"; the
 * foreign key does the real work, and a well-formed but unknown uuid simply
 * yields "not found" from the database.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Parse a JSON object body; null on anything the routes can't use. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Structural check for a browser `PushSubscription.toJSON()` payload — the
 * exact shape web-push consumes and `preferences.push_subscription` stores.
 */
export function isPushSubscription(value: unknown): value is PushSubscriptionJSON {
  if (value === null || typeof value !== 'object') return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length === 0) return false;
  const keys = sub.keys;
  if (keys === null || typeof keys !== 'object') return false;
  const { p256dh, auth } = keys as Record<string, unknown>;
  return typeof p256dh === 'string' && p256dh.length > 0 && typeof auth === 'string' && auth.length > 0;
}

/** Validate a category-slug array (empty allowed — mirrors the DB CHECK). */
export function isCategoryList(value: unknown): value is CategorySlug[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (slug): slug is CategorySlug =>
      typeof slug === 'string' && (CATEGORY_SLUGS as readonly string[]).includes(slug),
  );
}

/**
 * Uniform JSON error responses. Messages are caller-supplied static strings —
 * never raw error objects — so provider URLs, keys or secrets can't leak.
 */
export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
