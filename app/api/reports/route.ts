/**
 * GET /api/reports?userId=<uuid>[&hydrate=1] — a user's recent reports,
 * newest first. With hydrate=1 each report also carries `topics`: its
 * cache pointers resolved into renderable {category, markdown} sections.
 */

import { getHydratedReportsForUser, getReportsForUser } from '../../../lib/server/db/reports.ts';
import { jsonError } from '../../../lib/server/http.ts';
import { isUuid } from '../../../lib/shared/validation.ts';

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
