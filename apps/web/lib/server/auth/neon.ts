/**
 * Neon Managed Auth (Better Auth) for the web app: the `/api/auth/*` proxy,
 * page protection and cookie sessions. Created lazily so builds and tests
 * don't need the auth variables, and a missing one fails with a clear message.
 */

import 'server-only';

import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server';

import { env } from '../env.ts';

let instance: NeonAuth | null = null;

export function neonAuth(): NeonAuth {
  if (!instance) {
    const { baseUrl, cookieSecret } = env.neonAuth();
    instance = createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
  }
  return instance;
}

/** Session cookie set by the proxy; holds the Better Auth session token (see the mobile handoff). */
export const SESSION_TOKEN_COOKIE = '__Secure-neon-auth.session_token';
