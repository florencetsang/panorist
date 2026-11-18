import { Suspense } from 'react';

import { MobileGoogleSignIn } from '../../../components/mobile-google-sign-in.tsx';

export const metadata = { title: 'Sign in' };

/**
 * Opened by the mobile app in an in-app browser session to sign in with
 * Google. After OAuth completes, /mobile/handoff returns the session to the app.
 */
export default function Page() {
  return (
    <Suspense>
      <MobileGoogleSignIn />
    </Suspense>
  );
}
