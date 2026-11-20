/**
 * Native client for Neon Auth (managed Better Auth), via the web app's
 * /api/auth/* proxy.
 *
 * The browser SDK depends on cookies, BroadcastChannel and popups, so the
 * app speaks Better Auth's HTTP API directly instead:
 *
 *  - Sign-in returns a session token (the `set-auth-token` header, or the
 *    body's `token`), kept in the device keychain via SecureStore.
 *  - `get-session` with that token answers with a short-lived JWT in the
 *    `set-auth-jwt` header. The JWT, never the session token, authenticates
 *    calls to Panorist's own API (verified there against the JWKS).
 *  - Google sign-in runs on the web app in a system browser session; the
 *    web app hands the session token back through the app's URL scheme.
 */

import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { API_URL } from '../lib/config.ts';

const STORE_KEY = 'panorist.session.v1';
/** Renew the JWT this long before it expires. */
const JWT_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export interface StoredSession {
  token: string;
  user: AuthUser;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---- Storage ---------------------------------------------------------------

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    await SecureStore.deleteItemAsync(STORE_KEY);
    return null;
  }
}

async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  jwt = null;
  await SecureStore.deleteItemAsync(STORE_KEY);
}

// ---- HTTP ------------------------------------------------------------------

function sessionHeaders(token: string): Record<string, string> {
  // The web app's /api/auth proxy turns this into Neon Auth's session cookie.
  return { authorization: `Bearer ${token}` };
}

async function authFetch(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<{ data: unknown; headers: Headers }> {
  let res: Response;
  // An unreachable host can otherwise leave fetch pending indefinitely.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${API_URL}/api/auth/${path}`, {
      method: init.method ?? 'GET',
      signal: timeout.signal,
      // Never let the platform cookie jar add or keep a web session.
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.token ? sessionHeaders(init.token) : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    const where = __DEV__ ? ` (tried ${API_URL})` : '';
    throw new AuthError(0, 'NETWORK', `Can’t reach Panorist${where}. Check your connection.`);
  } finally {
    clearTimeout(timer);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data ?? {}) as { code?: string; message?: string; error?: string };
    throw new AuthError(
      res.status,
      body.code,
      body.message || body.error || `Request failed (${res.status})`,
    );
  }
  return { data, headers: res.headers };
}

function toUser(raw: unknown): AuthUser {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(u.id ?? ''),
    email: String(u.email ?? ''),
    name: typeof u.name === 'string' && u.name ? u.name : null,
    emailVerified: u.emailVerified === true,
  };
}

// ---- JWT for Panorist's API -----------------------------------------------

let jwt: { token: string; expiresAt: number } | null = null;

function jwtExpiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof exp === 'number' ? exp * 1000 : Date.now() + 5 * 60_000;
  } catch {
    return Date.now() + 5 * 60_000;
  }
}

/**
 * Validates the stored session with the auth server. Returns the fresh
 * user, or null when the session is gone (expired or signed out elsewhere).
 * Network failures throw, so callers can stay signed in while offline.
 */
export async function refreshSession(session: StoredSession): Promise<StoredSession | null> {
  const { data, headers } = await authFetch('get-session', { token: session.token });
  const body = data as { user?: unknown; session?: { token?: string } } | null;
  if (!body?.user) {
    await clearSession();
    return null;
  }
  let token = headers.get('set-auth-jwt');
  if (!token) {
    // Fallback: the JWT plugin's own endpoint.
    const res = await authFetch('token', { token: session.token });
    token = (res.data as { token?: string } | null)?.token ?? null;
  }
  if (token) jwt = { token, expiresAt: jwtExpiry(token) };
  const next = { token: headers.get('set-auth-token') || session.token, user: toUser(body.user) };
  await saveSession(next);
  return next;
}

/** A current JWT for Panorist's API, renewing it when close to expiry. */
export async function getJwt(session: StoredSession): Promise<string | null> {
  if (jwt && jwt.expiresAt - JWT_SKEW_MS > Date.now()) return jwt.token;
  jwt = null;
  await refreshSession(session);
  return (jwt as { token: string } | null)?.token ?? null;
}

/** Drop the cached JWT, e.g. after the API rejected it. */
export function invalidateJwt() {
  jwt = null;
}

// ---- Sign-in flows ----------------------------------------------------------

async function establish(token: string | null | undefined): Promise<StoredSession> {
  if (!token) throw new AuthError(500, undefined, 'Sign-in didn’t return a session.');
  const session = await refreshSession({ token, user: toUser(null) });
  if (!session) throw new AuthError(401, undefined, 'That session has already ended.');
  return session;
}

export async function signInWithEmail(email: string, password: string): Promise<StoredSession> {
  const { data, headers } = await authFetch('sign-in/email', {
    method: 'POST',
    body: { email, password },
  });
  return establish(headers.get('set-auth-token') || (data as { token?: string } | null)?.token);
}

/**
 * Creates the account. Returns the session, or null when the email must be
 * verified first (sign-up then returns no session).
 */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<StoredSession | null> {
  const { data, headers } = await authFetch('sign-up/email', {
    method: 'POST',
    body: { name, email, password },
  });
  const token = headers.get('set-auth-token') || (data as { token?: string } | null)?.token;
  return token ? establish(token) : null;
}

export async function sendVerificationCode(email: string): Promise<void> {
  await authFetch('email-otp/send-verification-otp', {
    method: 'POST',
    body: { email, type: 'email-verification' },
  });
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  await authFetch('email-otp/verify-email', { method: 'POST', body: { email, otp } });
}

/** Google, via the web app in a system browser session. Null if cancelled. */
export async function signInWithGoogle(): Promise<StoredSession | null> {
  const returnUrl = Linking.createURL('auth');
  const start = `${API_URL}/mobile/sign-in?redirect=${encodeURIComponent(returnUrl)}`;
  const result = await WebBrowser.openAuthSessionAsync(start, returnUrl);
  if (result.type !== 'success') return null;
  const params = Linking.parse(result.url).queryParams ?? {};
  if (typeof params.token !== 'string' || !params.token) {
    throw new AuthError(
      401,
      String(params.error ?? ''),
      'Google sign-in didn’t finish. Try again.',
    );
  }
  return establish(params.token);
}

export async function signOut(session: StoredSession | null): Promise<void> {
  if (session) {
    // Best effort: end the server session too; the local one goes regardless.
    await authFetch('sign-out', { method: 'POST', body: {}, token: session.token }).catch(() => {});
  }
  await clearSession();
}

/** Human copy for Better Auth error codes. */
export function authMessage(err: unknown): string {
  if (!(err instanceof AuthError)) return 'Something went wrong. Try again.';
  switch (err.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password don’t match.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists — sign in instead.';
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 8 characters for your password.';
    case 'INVALID_EMAIL':
      return 'Enter a valid email address.';
    case 'INVALID_OTP':
      return 'That code isn’t right. Check it and try again.';
    case 'OTP_EXPIRED':
      return 'That code has expired. Send a new one.';
  }
  if (err.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  return err.message;
}

export const isUnverified = (err: unknown) =>
  err instanceof AuthError && err.code === 'EMAIL_NOT_VERIFIED';
