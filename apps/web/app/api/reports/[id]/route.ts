/**
 * GET /api/reports/:id — one of the caller's reports with its topics
 * resolved to markdown, plus the AI highlights the caller is entitled to.
 * Another user's id is a 404.
 */

import { requireUser } from '../../../../lib/server/auth/require-user.ts';
import { getHydratedReportForUser } from '../../../../lib/server/db/reports.ts';
import {
  entitledKinds,
  filterTopicAnnotations,
  getEntitlements,
} from '../../../../lib/server/features.ts';
import { jsonError } from '../../../../lib/server/http.ts';
import { isReportId } from '@panorist/core/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isReportId(id)) return jsonError(404, 'report not found');

  try {
    const [report, entitlements] = await Promise.all([
      getHydratedReportForUser(user.id, id),
      getEntitlements(user.id),
    ]);
    if (!report) return jsonError(404, 'report not found');
    const kinds = entitledKinds(entitlements?.features ?? []);
    return Response.json(filterTopicAnnotations(report, kinds));
  } catch (err) {
    console.error('[api/reports/:id] GET failed', err);
    return jsonError(500, 'internal error');
  }
}
