/**
 * Prototype identity: who the app renders for.
 *
 * TODO(auth): replace this whole module with real authentication (Neon Auth /
 * Better Auth, or any IdP) — the prototype has no login at all. Every page and
 * API call trusts a plain `?userId=` query param, so anyone can read anyone's
 * briefings. That is deliberately fine while validating demand.
 *
 * Pure module — no imports — safe on the server and in the client bundle.
 */

/**
 * The fallback user when no ?userId= param is present: the seeded
 * test@example.com (see db/seed.sql). Override per environment (e.g. a fresh
 * database whose seed user has a different id) with NEXT_PUBLIC_TEST_USER_ID —
 * client-safe: Next inlines NEXT_PUBLIC_* vars into the bundle at build time.
 */
export const TEST_USER_ID: string = process.env.NEXT_PUBLIC_TEST_USER_ID ?? 'b19d6a47-bc86-43da-b963-88da91383ea8';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the current user id from page/search params, falling back to
 * TEST_USER_ID. Values are shaped like Next's `searchParams` (a string or
 * string[] per key — repeat params produce arrays).
 *
 * A present-but-malformed param falls back to the test user too (the API would
 * only 400 on it); a missing param uses the test user by design.
 * TODO(auth): this is the single seam real auth replaces.
 */
export function getUserIdFrom(
  search: Record<string, string | string[] | undefined>,
): string | null {
  const raw = search['userId'];
  const param = Array.isArray(raw) ? raw[0] : raw;
  if (param && UUID_RE.test(param)) return param;
  return TEST_USER_ID || null;
}