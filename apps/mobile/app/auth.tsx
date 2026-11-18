import { Redirect } from 'expo-router';

/**
 * Landing route for panorist://auth. The Google flow normally receives this
 * URL through the browser session; if the OS opens the app with it instead,
 * just go home (the sign-in screen is shown when no session was saved).
 */
export default function AuthReturn() {
  return <Redirect href="/" />;
}
