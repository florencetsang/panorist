import { Redirect } from 'expo-router';

import { useSession } from '../src/auth/session.tsx';

/**
 * Stack.Protected hides screens the guard rejects, so opening the app at a
 * hidden route (e.g. "/" while signed out, or "/sign-in" while signed in)
 * lands here instead of redirecting. Send the user to the right entry point.
 */
export default function NotFound() {
  const { status } = useSession();
  return <Redirect href={status === 'signed-in' ? '/' : '/sign-in'} />;
}
