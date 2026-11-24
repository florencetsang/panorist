/**
 * POST /api/insights  body {kind, key, displayName, reportId?, sourceText?}
 *      — "All I need to know" (event) or "Tell me more" (term). The target
 *      must be one the server produced (a highlight or a resolved
 *      selection). 200 Insight · 202 {status:'pending'} while another
 *      request generates it (ask again) · 403 feature off · 429 daily limit.
 *      Saved to the library when that feature is on.
 * GET  /api/insights[?starred=1][&before=<id>] — the caller's library,
 *      newest first, 50 per page.
 */

import { requireUser } from '../../../lib/server/auth/require-user.ts';
import { listUserInsights } from '../../../lib/server/db/insights.ts';
import {
  FEATURE_FOR_KIND,
  aiLimitReached,
  featureUnavailable,
  getEntitlements,
} from '../../../lib/server/features.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { explainForUser } from '../../../lib/server/insights/service.ts';
import { parseInsightRequest } from '@panorist/core/insights';
import { isReportId } from '@panorist/core/validation';

export const runtime = 'nodejs';
// Search-grounded event summaries are slow and may be retried.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');
  const input = parseInsightRequest(body);
  if (typeof input === 'string') return jsonError(400, input);

  try {
    const entitlements = await getEntitlements(user.id);
    if (!entitlements) return jsonError(404, 'user not found');
    if (!entitlements.features.includes(FEATURE_FOR_KIND[input.kind])) return featureUnavailable();

    const result = await explainForUser(user.id, entitlements, input, new Date());
    switch (result.status) {
      case 'ready':
        return Response.json(result.insight);
      case 'pending':
        return Response.json({ status: 'pending' }, { status: 202 });
      case 'quota-exceeded':
        return aiLimitReached();
      case 'unknown-target':
        return jsonError(404, 'nothing to explain for this key');
    }
  } catch (err) {
    console.error('[api/insights] POST failed', err);
    return jsonError(502, 'could not generate the explanation');
  }
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const params = new URL(request.url).searchParams;
  const before = params.get('before');
  if (before !== null && !isReportId(before)) return jsonError(400, 'before must be an insight id');

  try {
    const entitlements = await getEntitlements(user.id);
    if (!entitlements) return jsonError(404, 'user not found');
    if (!entitlements.features.includes('insight_library')) return featureUnavailable();
    const insights = await listUserInsights(user.id, {
      starred: params.get('starred') === '1',
      before,
    });
    return Response.json(insights);
  } catch (err) {
    console.error('[api/insights] GET failed', err);
    return jsonError(500, 'internal error');
  }
}
