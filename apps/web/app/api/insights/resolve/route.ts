/**
 * POST /api/insights/resolve  body {text, reportId} — classify a reader's
 * selection from one of their briefings into an explainable target
 * {kind, key, displayName}. 400 bad selection (or not in that briefing) ·
 * 403 feature off (or the resolved kind is) · 404 no such report · 422
 * nothing to explain · 429 daily limit.
 */

import { requireUser } from '../../../../lib/server/auth/require-user.ts';
import {
  FEATURE_FOR_KIND,
  aiLimitReached,
  featureUnavailable,
  getEntitlements,
} from '../../../../lib/server/features.ts';
import { jsonError, readJsonObject } from '../../../../lib/server/http.ts';
import { resolveForUser } from '../../../../lib/server/insights/service.ts';
import { isReportId } from '@panorist/core/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');
  const { text, reportId } = body;
  if (typeof text !== 'string') return jsonError(400, 'text (string) is required');
  if (!isReportId(reportId)) return jsonError(400, 'reportId must be a report id');

  try {
    const entitlements = await getEntitlements(user.id);
    if (!entitlements) return jsonError(404, 'user not found');
    if (!entitlements.features.includes('free_select')) return featureUnavailable();

    const result = await resolveForUser(user.id, entitlements, { text, reportId }, new Date());
    if (!result) return jsonError(404, 'report not found');
    switch (result.status) {
      case 'invalid':
        return jsonError(400, result.reason);
      case 'rejected':
        return jsonError(422, 'nothing to explain in this selection');
      case 'quota-exceeded':
        return aiLimitReached();
      case 'resolved':
        if (!entitlements.features.includes(FEATURE_FOR_KIND[result.target.kind])) {
          return featureUnavailable();
        }
        return Response.json(result.target);
    }
  } catch (err) {
    console.error('[api/insights/resolve] POST failed', err);
    return jsonError(502, 'could not look up this selection');
  }
}
