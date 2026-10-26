/**
 * /api/push/subscribe
 *
 * GET  — the VAPID public key (client half of subscribe; see lib/push-client.ts)
 * POST body {userId, subscription} — stores (or replaces) a browser
 *        web-push subscription for a user. Returns 204 with no body — the
 *        caller only needs response.ok.
 */

import { getUserWithPreferences, savePushSubscription } from '../../../../lib/db.ts';
import { isPushSubscription, isUuid, jsonError, readJsonObject } from '../../_lib/validate.ts';

// Read VAPID_PUBLIC_KEY per request rather than letting the handler be
// statically evaluated at build time (which could bake in a stale value).
export const dynamic = 'force-dynamic';

/**
 * The public key is not a secret — every browser receives it as the
 * `applicationServerKey` at subscribe time. The client fetches it here
 * because Next only inlines NEXT_PUBLIC_* env vars into client bundles, and
 * duplicating the value into a second env var just to publish a public key
 * isn't worth it.
 */
export async function GET(): Promise<Response> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return jsonError(500, 'VAPID_PUBLIC_KEY is not configured');
  return Response.json({ publicKey });
}

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
