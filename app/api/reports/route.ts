/**
 * GET /api/reports?userId=<uuid>
 *
 * A user's recent reports, newest first. Prototype: userId is a plain query
 * param (no auth) — the goal is validating demand, and every route stays
 * read-only until the cron secret matters.
 */

import { getReportsForUser } from '../../../lib/db.ts';
import { isUuid, jsonError } from '../_lib/validate.ts';

// GET reads live report rows per request (userId query param) — never
// cache or statically prerender one user's data.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) query parameter is required');

  try {
    // `content` is an array of markdown-cache pointers ({category, frequency,
    // to}); the frontend hydrates them separately (getReportMarkdown). This
    // endpoint returns rows exactly as stored.
    const reports = await getReportsForUser(userId);
    return Response.json(reports);
  } catch (err) {
    console.error('[api/reports] GET failed', err);
    return jsonError(500, 'internal error');
  }
}
