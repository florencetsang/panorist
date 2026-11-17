/**
 * Prototype identity: the app acts as the `?userId=` query-param user.
 *
 * TODO(auth): replace with real authentication. Anyone can currently read
 * and edit anyone's data by changing the query param. This module is the
 * single seam real auth replaces.
 */

import { isUuid } from './validation.ts';

/**
 * Fallback when no valid `?userId=` is present: the seeded test@example.com
 * user. NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
 */
export const TEST_USER_ID: string =
  process.env.NEXT_PUBLIC_TEST_USER_ID || 'b19d6a47-bc86-43da-b963-88da91383ea8';

/** Resolve the current user from Next-style search params (string | string[] per key). */
export function getUserIdFrom(
  search: Record<string, string | string[] | undefined>,
): string | null {
  const raw = search.userId;
  const param = Array.isArray(raw) ? raw[0] : raw;
  if (isUuid(param)) return param;
  return TEST_USER_ID || null;
}

export const MISSING_USER_MESSAGE =
  'No user id — add ?userId=<uuid> or set NEXT_PUBLIC_TEST_USER_ID.';
