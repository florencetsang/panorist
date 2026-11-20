/**
 * Bridges the mobile app's bearer session token and Neon Auth's cookie
 * session in the /api/auth proxy.
 *
 * Managed Neon Auth reads the session only from the signed
 * `__Secure-neon-auth.session_token` cookie, and returns it only in
 * Set-Cookie, which React Native can't read reliably. So the proxy:
 *  - copies that cookie's value into the `set-auth-token` response header,
 *    which the app stores; and
 *  - turns `Authorization: Bearer <that value>` back into the cookie when a
 *    request has no Neon Auth cookie of its own.
 *
 * This grants nothing new: whoever holds the token could send the cookie.
 */

import { SESSION_TOKEN_COOKIE } from './session-cookie.ts';

/** A signed session token is `<token>.<signature>`; a JWT has two dots. */
function isSignedSessionToken(value: string): boolean {
  return value.split('.').length === 2 && !/[\s;,]/.test(value);
}

/** The request to forward upstream, with a bearer session token as the cookie. */
export function withBearerSessionCookie(request: Request): Request {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match || !isSignedSessionToken(match[1])) return request;
  const cookie = request.headers.get('cookie') ?? '';
  if (cookie.includes('__Secure-neon-auth.')) return request;

  const headers = new Headers(request.headers);
  headers.set('cookie', `${SESSION_TOKEN_COOKIE}=${match[1]}`);
  headers.delete('authorization');
  return new Request(request, { headers });
}

/** The response with the session cookie's value also in `set-auth-token`. */
export function withSessionTokenHeader(response: Response): Response {
  const prefix = `${SESSION_TOKEN_COOKIE}=`;
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(prefix));
  const value = cookie?.slice(prefix.length).split(';', 1)[0];
  if (!value) return response;

  const headers = new Headers(response.headers);
  headers.set('set-auth-token', value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
