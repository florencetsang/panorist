import { Suspense } from 'react';
import { AuthForm } from '../../../components/auth-form.tsx';

export const metadata = { title: 'Sign in' };

export default function Page() {
  return (
    // AuthForm reads ?redirect (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <AuthForm mode="sign-in" />
    </Suspense>
  );
}
