/**
 * The route layer's only way to learn who is calling. Identity comes from
 * the session — a Neon Auth cookie (web) or a bearer JWT (mobile) — never
 * from request input. The auth identity is then mapped to our `users` row,
 * which is created on first sight.
 */

import 'server-only';

import { linkAppUser, type LinkResult } from '../db/users.ts';
import { jsonError } from '../http.ts';
import { bearerToken } from '../cron-secret.ts';
import { verifyBearerToken } from './bearer.ts';
import type { AppUser, AuthIdentity } from './identity.ts';
import { neonAuth } from './neon.ts';

export interface RequireUserDeps {
  verifyBearer: (token: string) => Promise<AuthIdentity | null>;
  cookieIdentity: () => Promise<AuthIdentity | null>;
  linkUser: (identity: AuthIdentity, timezoneHint: string | null) => Promise<LinkResult>;
}

async function cookieIdentity(): Promise<AuthIdentity | null> {
  const { data } = await neonAuth().getSession();
  const user = data?.user;
  if (!user?.id || !user.email) return null;
  return {
    authUserId: user.id,
    email: user.email,
    name: user.name || null,
    emailVerified: user.emailVerified === true,
  };
}

const defaultDeps: RequireUserDeps = {
  verifyBearer: verifyBearerToken,
  cookieIdentity,
  linkUser: linkAppUser,
};

/**
 * The caller's user, or the error Response to return as-is: 401 without a
 * valid session, 409 when the email belongs to an existing account that an
 * unverified sign-up must not claim.
 */
export async function requireUser(
  request: Request,
  deps: RequireUserDeps = defaultDeps,
): Promise<AppUser | Response> {
  let identity: AuthIdentity | null;
  try {
    // An explicit bearer token wins; it never falls back to the cookie.
    const token = bearerToken(request);
    identity = token !== null ? await deps.verifyBearer(token) : await deps.cookieIdentity();
  } catch (err) {
    console.error('[auth] session lookup failed', err);
    return jsonError(401, 'unauthorized');
  }
  if (!identity) return jsonError(401, 'unauthorized');

  let result: LinkResult;
  try {
    result = await deps.linkUser(identity, request.headers.get('x-timezone'));
  } catch (err) {
    console.error('[auth] linking the app user failed', err);
    return jsonError(500, 'internal error');
  }
  if (result.status === 'email-unverified') {
    return jsonError(409, 'verify your email to access the existing account for this address');
  }
  return { ...identity, id: result.userId };
}
