/**
 * Next 16 proxy (formerly middleware): signed-out visitors to app pages are
 * sent to /sign-in, and sessions are refreshed. It also completes OAuth
 * sign-in (the session-verifier exchange), so the OAuth landing pages must
 * be matched. Sign-in pages, /api/* and static assets stay public; API
 * routes enforce auth themselves (requireUser).
 */

import type { NextRequest } from 'next/server';

import { neonAuth } from './lib/server/auth/neon.ts';

export default function proxy(request: NextRequest) {
  return neonAuth().middleware({ loginUrl: '/sign-in' })(request);
}

export const config = {
  matcher: ['/', '/reports/:path*', '/preferences', '/mobile/handoff'],
};
