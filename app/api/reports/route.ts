/**
 * GET /api/reports?userId=<uuid>
 *
 * A user's recent reports, newest first. Prototype: userId is a plain query
 * param (no auth) — the goal is validating demand, and every route stays
 * read-only until the cron secret matters.
 */

import { getReportMarkdown, getReportsForUser } from '../../../lib/db.ts';
import { isUuid, jsonError } from '../_lib/validate.ts';

// GET reads live report rows per request (userId query param) — never
// cache or statically prerender one user's data.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) query parameter is required');

  try {
    // `content` is an array of markdown-cache pointers ({category, frequency,
    // to}); the report body itself lives in markdown_cache. Default: rows
    // exactly as stored. `hydrate=1` (the frontend's mode) resolves each
    // report's pointers into renderable {category, markdown} topics.
    const reports = await getReportsForUser(userId);
    if (new URL(request.url).searchParams.get('hydrate') !== '1') return Response.json(reports);
    // One Neon HTTPS query per (report × category) — ≤20 reports × a few
    // categories per request, run in parallel. Fine at prototype scale;
    // batch it if a list view ever gets hot.
    const hydrated = await Promise.all(
      reports.map(async (report) => ({
        ...report,
        topics: await getReportMarkdown(report.content),
      })),
    );
    return Response.json(hydrated);
  } catch (err) {
    console.error('[api/reports] GET failed', err);
    return jsonError(500, 'internal error');
  }
}
