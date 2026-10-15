/**
 * POST /api/push/subscribe  body {userId, subscription}
 *
 * Stores (or replaces) a browser web-push subscription for a user. Returns
 * 204 with no body — the caller only needs response.ok.
 */

import { getUserWithPreferences, savePushSubscription } from '../../../../lib/db.ts';
import { isPushSubscription, isUuid, jsonError, readJsonObject } from '../../_lib/validate.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { userId, subscription } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');
  if (!isPushSubscription(subscription)) {
    return jsonError(400, 'subscription must be a PushSubscription payload {endpoint, keys:{p256dh, auth}}');
  }

  try {
    // Existence check: savePushSubscription's UPDATE would silently affect 0
    // rows on a typo'd userId, quietly losing the subscription.
    if (!(await getUserWithPreferences(userId))) return jsonError(404, 'user not found');
    await savePushSubscription(userId, subscription);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[api/push/subscribe] failed', err);
    return jsonError(500, 'internal error');
  }
}
