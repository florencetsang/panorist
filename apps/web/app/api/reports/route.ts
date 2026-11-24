/**
 * GET   /api/reports[?hydrate=1] — the caller's recent reports, newest
 *       first. With hydrate=1 each report also carries `topics`: its cache
 *       pointers resolved into renderable {category, markdown, annotations}
 *       sections (annotations limited to the caller's entitled highlight kinds).
 * PATCH /api/reports  body {reportId, read} — mark one of the caller's
 *       reports read or unread; returns {id, readAt}.
 *
 * The user comes from the session (cookie or bearer JWT), never from input.
 */

import { requireUser } from '../../../lib/server/auth/require-user.ts';
import {
  getHydratedReportsForUser,
  getReportsForUser,
  setReportRead,
} from '../../../lib/server/db/reports.ts';
import {
  entitledKinds,
  filterTopicAnnotations,
  getEntitlements,
} from '../../../lib/server/features.ts';
import { jsonError, readJsonObject } from '../../../lib/server/http.ts';
import { isReportId } from '@panorist/core/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  try {
    const hydrate = new URL(request.url).searchParams.get('hydrate') === '1';
    if (!hydrate) return Response.json(await getReportsForUser(user.id));
    const [reports, entitlements] = await Promise.all([
      getHydratedReportsForUser(user.id),
      getEntitlements(user.id),
    ]);
    const kinds = entitledKinds(entitlements?.features ?? []);
    return Response.json(reports.map((report) => filterTopicAnnotations(report, kinds)));
  } catch (err) {
    console.error('[api/reports] GET failed', err);
    return jsonError(500, 'internal error');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { reportId, read } = body;
  if (!isReportId(reportId)) return jsonError(400, 'reportId (numeric string) is required');
  if (typeof read !== 'boolean') return jsonError(400, 'read (boolean) is required');

  try {
    // Scoped to the caller: another user's report id is a 404.
    const status = await setReportRead(user.id, reportId, read);
    return status ? Response.json(status) : jsonError(404, 'report not found');
  } catch (err) {
    console.error('[api/reports] PATCH failed', err);
    return jsonError(500, 'internal error');
  }
}
