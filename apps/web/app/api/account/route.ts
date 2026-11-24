/**
 * DELETE /api/account — permanently delete the caller's account: preferences,
 * reports and the sign-in itself. Answers 204; the client then drops its session.
 *
 * The user comes from the session (cookie or bearer JWT), never from input.
 */

import { requireUser } from '../../../lib/server/auth/require-user.ts';
import { deleteAccount } from '../../../lib/server/db/users.ts';
import { jsonError } from '../../../lib/server/http.ts';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  try {
    const deleted = await deleteAccount(user.id, user.authUserId);
    return deleted ? new Response(null, { status: 204 }) : jsonError(404, 'user not found');
  } catch (err) {
    console.error('[api/account] DELETE failed', err);
    return jsonError(500, 'internal error');
  }
}
