/**
 * /api/auth/* — Neon Auth proxy. The browser auth client (and the mobile
 * app) talk to this same-origin route; it forwards to the branch's Managed
 * Better Auth and manages the session cookies. The app has no cookie jar, so
 * its bearer session token is bridged to the cookie (see mobile-session.ts).
 */

import {
  withBearerSessionCookie,
  withSessionTokenHeader,
} from '../../../../lib/server/auth/mobile-session.ts';
import { neonAuth } from '../../../../lib/server/auth/neon.ts';

type Handler = ReturnType<ReturnType<typeof neonAuth>['handler']>['GET'];
type Context = Parameters<Handler>[1];

export const dynamic = 'force-dynamic';

const forward =
  (method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH') => async (request: Request, ctx: Context) =>
    withSessionTokenHeader(
      await neonAuth()
        .handler()
        [method](withBearerSessionCookie(request) as typeof request, ctx),
    );

export const GET = forward('GET');
export const POST = forward('POST');
export const PUT = forward('PUT');
export const DELETE = forward('DELETE');
export const PATCH = forward('PATCH');
