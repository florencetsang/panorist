/**
 * GET /mobile/handoff?redirect=<app url> — last hop of the mobile app's
 * browser-based sign-in (Google). The proxy has already turned the OAuth
 * result into a web session; this hands that session's token to the app by
 * redirecting to its URL scheme, where it is used as a bearer credential.
 */

import { cookies } from 'next/headers';

import { isAllowedAppRedirect } from '../../../lib/server/auth/mobile-redirect.ts';
import { SESSION_TOKEN_COOKIE } from '../../../lib/server/auth/neon.ts';
import { env } from '../../../lib/server/env.ts';
import { jsonError } from '../../../lib/server/http.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('redirect') ?? '';
  if (!isAllowedAppRedirect(target, env.mobileScheme(), process.env.NODE_ENV !== 'production')) {
    return jsonError(400, 'redirect must be the Panorist app URL');
  }

  const token = (await cookies()).get(SESSION_TOKEN_COOKIE)?.value;
  const url = new URL(target);
  if (token) url.searchParams.set('token', token);
  else url.searchParams.set('error', 'no_session');
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), 'cache-control': 'no-store' },
  });
}
