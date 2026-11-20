/**
 * Only the app's own scheme may receive a session token from the mobile
 * sign-in handoff (plus Expo Go's `exp://` in development), so the token
 * can't be sent to another site.
 */
export function isAllowedAppRedirect(target: string, scheme: string, dev: boolean): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  return url.protocol === `${scheme}:` || (dev && url.protocol === 'exp:');
}
