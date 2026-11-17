/**
 * GET   /api/preferences?userId=<uuid> — the user joined with their preferences.
 * PATCH /api/preferences  body {userId, patch} — partial update; returns the stored row.
 */

import { getUserWithPreferences, updatePreferences } from '../../../lib/server/db/users.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { isPlainObject, isUuid, parsePreferencesPatch } from '../../../lib/shared/validation.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) query parameter is required');

  try {
    const user = await getUserWithPreferences(userId);
    return user ? Response.json(user) : jsonError(404, 'user not found');
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
  if (!isPlainObject(patch)) return jsonError(400, 'patch (object) is required');

  const validated = parsePreferencesPatch(patch);
  if (typeof validated === 'string') return jsonError(400, validated);

  try {
    const updated = await updatePreferences(userId, validated);
    return updated ? Response.json(updated) : jsonError(404, 'user not found');
  } catch (err) {
    console.error('[api/preferences] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}
