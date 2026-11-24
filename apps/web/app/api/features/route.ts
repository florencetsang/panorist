/**
 * GET /api/features — the caller's plan, the AI features enabled for them
 * (global switch AND plan) and today's uncached-AI-call allowance.
 */

import { requireUser } from '../../../lib/server/auth/require-user.ts';
import { getAiCallsUsed } from '../../../lib/server/db/insights.ts';
import { getEntitlements } from '../../../lib/server/features.ts';
import { jsonError } from '../../../lib/server/http.ts';
import { aiDay } from '../../../lib/server/insights/service.ts';
import type { FeaturesWire } from '@panorist/core/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  try {
    const entitlements = await getEntitlements(user.id);
    if (!entitlements) return jsonError(404, 'user not found');
    const used = await getAiCallsUsed(user.id, aiDay(new Date()));
    const body: FeaturesWire = {
      plan: entitlements.plan,
      features: entitlements.features,
      dailyAiCalls: { limit: entitlements.dailyAiCalls, used },
    };
    return Response.json(body);
  } catch (err) {
    console.error('[api/features] GET failed', err);
    return jsonError(500, 'internal error');
  }
}
