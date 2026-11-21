'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { authClient } from '../lib/client/auth.ts';
import { authErrorMessage, oauthErrorMessage } from '../lib/client/auth-errors.ts';
import { Button, GoogleIcon, Notice } from './ui.tsx';
import { Wordmark } from './wordmark.tsx';

export function MobileGoogleSignIn() {
  const params = useSearchParams();
  const appRedirect = params.get('redirect') ?? '';
  const oauthError = params.get('error');
  const [error, setError] = useState<string | null>(
    oauthError ? oauthErrorMessage(oauthError) : null,
  );
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function start() {
    setBusy(true);
    setError(null);
    const handoff = `${location.origin}/mobile/handoff?redirect=${encodeURIComponent(appRedirect)}`;
    try {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: handoff,
        // Failures return to this page with ?error=, which stops the auto-start.
        errorCallbackURL: `${location.origin}${location.pathname}?redirect=${encodeURIComponent(appRedirect)}`,
      });
      // On success the browser navigates away; only failures land here.
      if (error) throw error;
    } catch (err) {
      setError(authErrorMessage(err as { code?: string; message?: string }));
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current || !appRedirect || oauthError) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appRedirect, oauthError]);

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="w-full max-w-sm text-center">
        <Wordmark className="text-4xl" />
        {!appRedirect ? (
          <Notice className="mt-8">Open this page from the Panorist app to sign in.</Notice>
        ) : (
          <>
            <p className="mt-4 text-ink-muted">Continue to Google to sign in to the app.</p>
            {error && <Notice className="mt-6">{error}</Notice>}
            <Button variant="secondary" onClick={start} busy={busy} className="mt-8 w-full">
              <GoogleIcon />
              Continue with Google
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
