/**
 * GET   /api/preferences — the caller joined with their preferences.
 * PATCH /api/preferences  body {patch} — partial update; returns the stored row.
 *
 * The user comes from the session (cookie or bearer JWT), never from input.
 */

import { requireUser } from '../../../lib/server/auth/require-user.ts';
import { getUserWithPreferences, updatePreferences } from '../../../lib/server/db/users.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { isPlainObject, parsePreferencesPatch } from '@panorist/core/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  try {
    const prefs = await getUserWithPreferences(user.id);
    return prefs ? Response.json(prefs) : jsonError(404, 'user not found');
  } catch (err) {
    console.error('[api/preferences] GET failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { patch } = body;
  if (!isPlainObject(patch)) return jsonError(400, 'patch (object) is required');

  const validated = parsePreferencesPatch(patch);
  if (typeof validated === 'string') return jsonError(400, validated);

  try {
    const updated = await updatePreferences(user.id, validated);
    return updated ? Response.json(updated) : jsonError(404, 'user not found');
  } catch (err) {
    console.error('[api/preferences] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}
