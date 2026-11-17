/**
 * Pure runtime type guards for untrusted input (request bodies, query
 * params, jsonb columns).
 */

import { CATEGORY_SLUGS, isCategorySlug, type CategorySlug } from './categories.ts';
import type { PreferencesPatch, PushSubscriptionJSON } from './types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check only — an unknown but well-formed id is the database's "not found". */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Empty is allowed (mirrors the DB CHECK). */
export function isCategoryList(value: unknown): value is CategorySlug[] {
  return Array.isArray(value) && value.every(isCategorySlug);
}

/**
 * Keys must be what web-push can actually encrypt with (RFC 8291): p256dh is
 * a 65-byte P-256 point (87 unpadded base64url chars) and auth ≥16 bytes
 * (≥22 chars). Junk keys would otherwise be stored and fail every later send.
 */
const P256DH_RE = /^[A-Za-z0-9_-]{87}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{22,}$/;

export function isPushSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!isPlainObject(value)) return false;
  if (typeof value.endpoint !== 'string' || value.endpoint.length === 0) return false;
  if (!isPlainObject(value.keys)) return false;
  const { p256dh, auth } = value.keys;
  return (
    typeof p256dh === 'string' &&
    P256DH_RE.test(p256dh) &&
    typeof auth === 'string' &&
    AUTH_RE.test(auth)
  );
}

export function isDeliveryHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

// ---------------------------------------------------------------------------
// Preferences patch
// ---------------------------------------------------------------------------

type PatchValidators = {
  [K in keyof Required<PreferencesPatch>]: {
    isValid: (value: unknown) => value is PreferencesPatch[K];
    error: string;
  };
};

const PATCH_VALIDATORS: PatchValidators = {
  deliveryHour: {
    isValid: isDeliveryHour,
    error: 'deliveryHour must be an integer between 0 and 23',
  },
  dailyCategories: {
    isValid: isCategoryList,
    error: `dailyCategories must be an array of slugs: ${CATEGORY_SLUGS.join(', ')}`,
  },
  weeklyCategories: {
    isValid: isCategoryList,
    error: `weeklyCategories must be an array of slugs: ${CATEGORY_SLUGS.join(', ')}`,
  },
  pushSubscription: {
    isValid: (value): value is PreferencesPatch['pushSubscription'] =>
      value === null || isPushSubscription(value),
    error: 'pushSubscription must be a subscription object or null',
  },
};

/**
 * Unknown keys are rejected rather than ignored, so a typo fails loudly.
 * Empty category lists are valid (both empty = paused).
 */
export function parsePreferencesPatch(input: Record<string, unknown>): PreferencesPatch | string {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(PATCH_VALIDATORS, key)) {
      return `unknown patch field "${key}" — allowed: ${Object.keys(PATCH_VALIDATORS).join(', ')}`;
    }
    const validator = PATCH_VALIDATORS[key as keyof PatchValidators];
    if (!validator.isValid(value)) return validator.error;
    patch[key] = value;
  }
  return patch as PreferencesPatch;
}
