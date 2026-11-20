/**
 * The browser's API client. Same origin, so the Neon Auth session cookie
 * identifies the user; the timezone header seeds a new account's timezone.
 */

import { createApi } from '@panorist/core/api';

export const api = createApi({
  getAuthHeaders: () => ({ 'x-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone }),
  onUnauthorized: () => {
    // Session expired mid-visit: start over at sign-in, then come back here.
    const back = encodeURIComponent(location.pathname + location.search);
    // A full navigation (not the router) also drops any stale client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.assign(`/sign-in?redirect=${back}`);
  },
});

export { ApiError } from '@panorist/core/api';
