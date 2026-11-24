/**
 * GET    /api/insights/:id — one saved insight.
 * PATCH  /api/insights/:id  body {starred} — star or unstar it.
 * DELETE /api/insights/:id — remove it from the library (the shared
 *        explanation stays). Another user's id is a 404.
 */

import { requireUser } from '../../../../lib/server/auth/require-user.ts';
import type { AppUser } from '../../../../lib/server/auth/identity.ts';
import {
  deleteUserInsight,
  getUserInsight,
  setUserInsightStarred,
} from '../../../../lib/server/db/insights.ts';
import { featureUnavailable, getEntitlements } from '../../../../lib/server/features.ts';
import { jsonError, readJsonObject } from '../../../../lib/server/http.ts';
import { isReportId } from '@panorist/core/validation';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The user and a well-formed id, or the error Response to return. */
async function authorize(request: Request, params: Params['params']) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  // Same shape as a report id: a positive bigint as a string.
  if (!isReportId(id)) return jsonError(404, 'insight not found');
  const entitlements = await getEntitlements(user.id);
  if (!entitlements) return jsonError(404, 'user not found');
  if (!entitlements.features.includes('insight_library')) return featureUnavailable();
  return { user, id } satisfies { user: AppUser; id: string };
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const auth = await authorize(request, params);
    if (auth instanceof Response) return auth;
    const insight = await getUserInsight(auth.user.id, auth.id);
    return insight ? Response.json(insight) : jsonError(404, 'insight not found');
  } catch (err) {
    console.error('[api/insights/:id] GET failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  try {
    const auth = await authorize(request, params);
    if (auth instanceof Response) return auth;
    const body = await readJsonObject(request);
    if (!body) return jsonError(400, 'expected a JSON object body');
    if (typeof body.starred !== 'boolean') return jsonError(400, 'starred (boolean) is required');
    const insight = await setUserInsightStarred(auth.user.id, auth.id, body.starred);
    return insight ? Response.json(insight) : jsonError(404, 'insight not found');
  } catch (err) {
    console.error('[api/insights/:id] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  try {
    const auth = await authorize(request, params);
    if (auth instanceof Response) return auth;
    const deleted = await deleteUserInsight(auth.user.id, auth.id);
    return deleted ? new Response(null, { status: 204 }) : jsonError(404, 'insight not found');
  } catch (err) {
    console.error('[api/insights/:id] DELETE failed', err);
    return jsonError(500, 'internal error');
  }
}
