/**
 * GET   /api/reports?userId=<uuid>[&hydrate=1] — a user's recent reports,
 *       newest first. With hydrate=1 each report also carries `topics`: its
 *       cache pointers resolved into renderable {category, markdown} sections.
 * PATCH /api/reports  body {userId, reportId, read} — mark a report read or
 *       unread; returns {id, readAt}.
 */

import {
  getHydratedReportsForUser,
  getReportsForUser,
  setReportRead,
} from '../../../lib/server/db/reports.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { isReportId, isUuid } from '../../../lib/shared/validation.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const userId = params.get('userId');
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) query parameter is required');

  try {
    const reports =
      params.get('hydrate') === '1'
        ? await getHydratedReportsForUser(userId)
        : await getReportsForUser(userId);
    return Response.json(reports);
  } catch (err) {
    console.error('[api/reports] GET failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { userId, reportId, read } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');
  if (!isReportId(reportId)) return jsonError(400, 'reportId (numeric string) is required');
  if (typeof read !== 'boolean') return jsonError(400, 'read (boolean) is required');

  try {
    const status = await setReportRead(userId, reportId, read);
    return status ? Response.json(status) : jsonError(404, 'report not found');
  } catch (err) {
    console.error('[api/reports] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}
