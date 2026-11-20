/** Human copy for Better Auth error codes; falls back to the server's message. */

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match.',
  USER_ALREADY_EXISTS: 'An account with this email already exists — sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists — sign in instead.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  INVALID_EMAIL: 'Enter a valid email address.',
  EMAIL_NOT_VERIFIED: 'Verify your email first — we sent you a code.',
  INVALID_OTP: 'That code isn’t right. Check it and try again.',
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a minute, then try again.',
};

export function authErrorMessage(
  error: { code?: string; message?: string; status?: number } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Try again.';
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error.status === 429) return MESSAGES.TOO_MANY_ATTEMPTS;
  return error.message || 'Something went wrong. Try again.';
}

export const isUnverified = (error: { code?: string } | null | undefined) =>
  error?.code === 'EMAIL_NOT_VERIFIED';
