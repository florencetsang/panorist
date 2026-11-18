/**
 * Bearer-JWT identity for non-browser clients (the mobile app). Neon Auth
 * issues short-lived EdDSA JWTs (`GET /api/auth/token`); they are verified
 * here against the branch's JWKS. No custom claims: `sub` is the auth user id.
 */

import 'server-only';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { env } from '../env.ts';
import type { AuthIdentity } from './identity.ts';

let jwks: JWTVerifyGetKey | null = null;

/** Allowed `iss` values: Better Auth uses its base URL; accept its origin too. */
function issuers(): string[] {
  const { baseUrl } = env.neonAuth();
  return [baseUrl, new URL(baseUrl).origin];
}

/** The identity in a valid token, or null for an invalid/expired one. */
export async function verifyBearerToken(token: string): Promise<AuthIdentity | null> {
  jwks ??= createRemoteJWKSet(new URL(env.neonAuthJwksUrl()));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: issuers() });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      authUserId: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
      emailVerified: payload.emailVerified === true,
    };
  } catch {
    return null;
  }
}
