/**
 * POST /api/generate  body {userId} — report worker for one user, called by
 * /api/cron (or an admin). Guarded by header `x-cron-secret` because it
 * spends LLM budget.
 *
 * Responses: 201 {dailyReportId, weeklyReportId} · 200 with both null when
 * nothing is due · 502 when every due category failed.
 */

import { checkCronSecret, secretCheckResponse } from '../../../lib/server/auth.ts';
import { getUserWithPreferences } from '../../../lib/server/db/users.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { generateDueReports } from '../../../lib/server/reports/due-reports.ts';
import { isUuid } from '../../../lib/shared/validation.ts';

export const runtime = 'nodejs';
// Search-grounded LLM calls are slow; a local Monday runs two reports.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const auth = checkCronSecret(request.headers.get('x-cron-secret'));
  if (auth !== 'ok') return secretCheckResponse(auth, 'api/generate');

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');
  const { userId } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');

  try {
    const user = await getUserWithPreferences(userId);
    if (!user) return jsonError(404, 'user not found');

    const result = await generateDueReports(user, new Date());
    switch (result.status) {
      case 'nothing-due':
        return Response.json({ dailyReportId: null, weeklyReportId: null });
      case 'no-content':
        return jsonError(502, 'report generation produced no content');
      case 'generated':
        return Response.json(
          { dailyReportId: result.dailyReportId, weeklyReportId: result.weeklyReportId },
          { status: 201 },
        );
    }
  } catch (err) {
    console.error('[api/generate] failed', err);
    return jsonError(500, 'internal error');
  }
}
