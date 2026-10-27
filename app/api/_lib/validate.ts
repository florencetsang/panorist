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
 * Key-shape gate, matched to what web-push will actually encrypt with:
 * `p256dh` is the 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y) and `auth`
 * a ≥16-byte secret (RFC 8291); browsers emit both as unpadded base64url —
 * exactly 87 chars for p256dh, ≥22 for a 16-byte auth. Without this, junk
 * from API examples (e.g. the Postman payload) sails into
 * `preferences.push_subscription` and then breaks every later sendPush(),
 * since web-push throws before even contacting the push service.
 */
const P256DH_RE = /^[A-Za-z0-9_-]{87}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{22,}$/;

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
  return (
    typeof p256dh === 'string' &&
    P256DH_RE.test(p256dh) &&
    typeof auth === 'string' &&
    AUTH_RE.test(auth)
  );
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
