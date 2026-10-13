/**
 * GET   /api/preferences?userId=<uuid>  — current preferences (joined user row).
 * PATCH /api/preferences  body {userId, patch}  — partial update, returns the
 *        updated row.
 */

import { getUserWithPreferences, updatePreferences } from '../../../lib/db.ts';
import { CATEGORY_SLUGS, type PreferencesPatch } from '../../../lib/types.ts';
import {
  isCategoryList,
  isPushSubscription,
  isUuid,
  jsonError,
  readJsonObject,
} from '../_lib/validate.ts';

// ---------------------------------------------------------------------------
// PATCH body validation
// ---------------------------------------------------------------------------

const PATCH_FIELDS = ['frequency', 'deliveryHour', 'categories', 'pushSubscription'] as const;
type PatchField = (typeof PATCH_FIELDS)[number];

/**
 * Validate an unknown patch object into a `PreferencesPatch`, or return an
 * error message. Unknown keys are REJECTED rather than ignored — a typo like
 * "categorie" silently doing nothing is much harder to debug at prototype
 * time than an explicit 400.
 */
function validatePatch(input: Record<string, unknown>): PreferencesPatch | string {
  const patch: PreferencesPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(PATCH_FIELDS as readonly string[]).includes(key)) {
      return `unknown patch field "${key}" — allowed: ${PATCH_FIELDS.join(', ')}`;
    }
    switch (key as PatchField) {
      case 'frequency':
        if (value !== 'daily' && value !== 'weekly') return 'frequency must be "daily" or "weekly"';
        patch.frequency = value;
        break;
      case 'deliveryHour':
        // Local wall-clock hour in the user's timezone (schema CHECK: 0–23).
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 23) {
          return 'deliveryHour must be an integer between 0 and 23';
        }
        patch.deliveryHour = value;
        break;
      case 'categories':
        if (!isCategoryList(value)) {
          return `categories must be an array of slugs: ${CATEGORY_SLUGS.join(', ')}`;
        }
        patch.categories = value;
        break;
      case 'pushSubscription':
        // Null clears the subscription; the dedicated /api/push/subscribe
        // route is the normal write path, but PATCH supports it for symmetry.
        if (value !== null && !isPushSubscription(value)) {
          return 'pushSubscription must be a subscription object or null';
        }
        patch.pushSubscription = value;
        break;
    }
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) query parameter is required');

  try {
    const user = await getUserWithPreferences(userId);
    if (!user) return jsonError(404, 'user not found');
    return Response.json(user);
  } catch (err) {
    console.error('[api/preferences] GET failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { userId, patch } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return jsonError(400, 'patch (object) is required');
  }

  const validated = validatePatch(patch as Record<string, unknown>);
  if (typeof validated === 'string') return jsonError(400, validated);

  try {
    // Existence check first: a 0-row UPDATE would otherwise "succeed" silently.
    if (!(await getUserWithPreferences(userId))) return jsonError(404, 'user not found');

    await updatePreferences(userId, validated);
    // updatePreferences writes and returns void — re-read so the response is
    // the row exactly as stored (fresh updated_at included).
    return Response.json(await getUserWithPreferences(userId));
  } catch (err) {
    console.error('[api/preferences] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}
