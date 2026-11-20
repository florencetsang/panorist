/**
 * GET  /api/push/subscribe — the VAPID public key (not a secret; browsers
 *      need it as `applicationServerKey`).
 * POST /api/push/subscribe  body {subscription} — store or replace the
 *      caller's browser push subscription. 204 on success.
 */

import { requireUser } from '../../../../lib/server/auth/require-user.ts';
import { savePushSubscription } from '../../../../lib/server/db/users.ts';
import { env } from '../../../../lib/server/env.ts';
import { jsonError, readJsonObject } from '../../../../lib/server/http.ts';
import { isPushSubscription } from '@panorist/core/validation';

// Read the key per request rather than baking it in at build time.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const publicKey = env.vapidPublicKey();
  if (!publicKey) return jsonError(500, 'VAPID_PUBLIC_KEY is not configured');
  return Response.json({ publicKey });
}

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { subscription } = body;
  if (!isPushSubscription(subscription)) {
    return jsonError(
      400,
      'subscription must be a PushSubscription payload {endpoint, keys:{p256dh, auth}}',
    );
  }

  try {
    const saved = await savePushSubscription(user.id, subscription);
    return saved ? new Response(null, { status: 204 }) : jsonError(404, 'user not found');
  } catch (err) {
    console.error('[api/push/subscribe] failed', err);
    return jsonError(500, 'internal error');
  }
}
