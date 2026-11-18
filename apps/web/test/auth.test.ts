import { describe, expect, it, vi } from 'vitest';

import type { AuthIdentity } from '../lib/server/auth/identity.ts';
import { isAllowedAppRedirect } from '../lib/server/auth/mobile-redirect.ts';
import { requireUser, type RequireUserDeps } from '../lib/server/auth/require-user.ts';

// The real SDK pulls in the Next.js request runtime; tests inject identities instead.
vi.mock('../lib/server/auth/neon.ts', () => ({ neonAuth: () => ({}) }));

const ALICE: AuthIdentity = {
  authUserId: 'auth-alice',
  email: 'alice@example.com',
  name: 'Alice',
  emailVerified: true,
};
const APP_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function deps(overrides: Partial<RequireUserDeps> = {}): RequireUserDeps {
  return {
    verifyBearer: vi.fn(async () => null),
    cookieIdentity: vi.fn(async () => null),
    linkUser: vi.fn(async () => ({ status: 'linked' as const, userId: APP_ID })),
    ...overrides,
  };
}

const req = (headers: Record<string, string> = {}) =>
  new Request('https://panorist.test/api/reports', { headers });

describe('requireUser', () => {
  it('rejects a request with no session', async () => {
    const res = await requireUser(req(), deps());
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it('uses the cookie session and links the app user with the timezone hint', async () => {
    const d = deps({ cookieIdentity: async () => ALICE });
    const user = await requireUser(req({ 'x-timezone': 'Asia/Hong_Kong' }), d);
    expect(user).toEqual({ ...ALICE, id: APP_ID });
    expect(d.linkUser).toHaveBeenCalledWith(ALICE, 'Asia/Hong_Kong');
  });

  it('prefers a bearer token and never falls back to the cookie', async () => {
    const d = deps({ cookieIdentity: vi.fn(async () => ALICE) });
    const res = await requireUser(req({ authorization: 'Bearer bad.jwt' }), d);
    expect((res as Response).status).toBe(401);
    expect(d.verifyBearer).toHaveBeenCalledWith('bad.jwt');
    expect(d.cookieIdentity).not.toHaveBeenCalled();

    const ok = await requireUser(
      req({ authorization: 'Bearer good.jwt' }),
      deps({ verifyBearer: async () => ALICE }),
    );
    expect(ok).toMatchObject({ id: APP_ID, email: ALICE.email });
  });

  it('treats a failing session lookup as signed out', async () => {
    const d = deps({
      verifyBearer: async () => {
        throw new Error('jwks down');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await requireUser(req({ authorization: 'Bearer x' }), d);
    expect((res as Response).status).toBe(401);
  });

  it('answers 409 when an unverified identity matches an existing account', async () => {
    const d = deps({
      cookieIdentity: async () => ({ ...ALICE, emailVerified: false }),
      linkUser: async () => ({ status: 'email-unverified' }),
    });
    expect(((await requireUser(req(), d)) as Response).status).toBe(409);
  });
});

describe('isAllowedAppRedirect', () => {
  it('only allows the app scheme (and Expo Go in development)', () => {
    expect(isAllowedAppRedirect('panorist://auth', 'panorist', false)).toBe(true);
    expect(isAllowedAppRedirect('https://evil.example/cb', 'panorist', false)).toBe(false);
    expect(isAllowedAppRedirect('javascript:alert(1)', 'panorist', true)).toBe(false);
    expect(isAllowedAppRedirect('exp://192.168.1.2:8081/--/auth', 'panorist', false)).toBe(false);
    expect(isAllowedAppRedirect('exp://192.168.1.2:8081/--/auth', 'panorist', true)).toBe(true);
    expect(isAllowedAppRedirect('not a url', 'panorist', true)).toBe(false);
  });
});
