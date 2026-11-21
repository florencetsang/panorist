/**
 * Human copy for auth errors; falls back to the server's message.
 *
 * The Neon browser SDK rewrites Better Auth's codes (EMAIL_NOT_VERIFIED)
 * into its own (email_not_confirmed), so both spellings are listed.
 */

const ALREADY_EXISTS = 'An account with this email already exists — sign in instead.';
const BAD_CREDENTIALS = 'That email and password don’t match.';
const NOT_VERIFIED = 'Verify your email first — we sent you a code.';

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: BAD_CREDENTIALS,
  invalid_credentials: BAD_CREDENTIALS,
  USER_ALREADY_EXISTS: ALREADY_EXISTS,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: ALREADY_EXISTS,
  user_already_exists: ALREADY_EXISTS,
  email_exists: ALREADY_EXISTS,
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  weak_password: 'Use a password of at least 8 characters.',
  INVALID_EMAIL: 'Enter a valid email address.',
  email_address_invalid: 'Enter a valid email address.',
  EMAIL_NOT_VERIFIED: NOT_VERIFIED,
  email_not_confirmed: NOT_VERIFIED,
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
  error?.code === 'EMAIL_NOT_VERIFIED' || error?.code === 'email_not_confirmed';

/**
 * Copy for the `?error=` code that Better Auth appends to errorCallbackURL
 * when a social sign-in fails after leaving the site.
 */
export function oauthErrorMessage(code: string): string {
  switch (code) {
    case 'account_not_linked':
      // Linking needs a verified local email, so an unverified sign-up
      // can't take over the address.
      return 'This email already has a Panorist account. Sign in with your email and password first — once your email is verified, Google sign-in will work too.';
    case 'access_denied':
      return 'Google sign-in was cancelled.';
    case 'email_not_found':
      return 'Google didn’t share an email address, so we couldn’t sign you in.';
    default:
      return 'Google sign-in didn’t finish. Try again.';
  }
}
