'use client';

/**
 * Sign-in and sign-up, including the email-code verification step that
 * Neon Auth requires when "verify email at sign-up" is on. Codes work with
 * Neon's shared SMTP, so no app mailer is needed.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { authClient } from '../lib/client/auth.ts';
import { authErrorMessage, isUnverified } from '../lib/client/auth-errors.ts';
import { safeRedirect } from '../lib/client/redirect.ts';
import { Button, Field, GoogleIcon, Notice } from './ui.tsx';

type Mode = 'sign-in' | 'sign-up';
type AuthError = { code?: string; message?: string; status?: number };

/** The SDK reports failures as `{error}` or by throwing; treat both the same. */
async function attempt(call: () => Promise<{ error?: AuthError | null } | unknown>) {
  try {
    const result = (await call()) as { error?: AuthError | null; data?: unknown };
    return { error: result?.error ?? null, data: result?.data };
  } catch (err) {
    return { error: (err ?? {}) as AuthError, data: undefined };
  }
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const redirect = safeRedirect(useSearchParams().get('redirect'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  function done() {
    router.replace(redirect);
    router.refresh();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy('email');
    setError(null);
    if (mode === 'sign-up') {
      const { error } = await attempt(() =>
        authClient.signUp.email({ email, password, name: name.trim() || email.split('@')[0] }),
      );
      if (error) {
        setBusy(null);
        return setError(authErrorMessage(error));
      }
    }
    const { error } = await attempt(() => authClient.signIn.email({ email, password }));
    setBusy(null);
    if (isUnverified(error)) {
      await sendCode();
      return setVerifying(true);
    }
    if (error) return setError(authErrorMessage(error));
    done();
  }

  async function sendCode() {
    await attempt(() =>
      authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' }),
    );
  }

  async function google() {
    setBusy('google');
    setError(null);
    const { error } = await attempt(() =>
      authClient.signIn.social({
        provider: 'google',
        callbackURL: `${location.origin}${redirect}`,
      }),
    );
    // On success the browser navigates away; only failures land here.
    if (error) {
      setBusy(null);
      setError(authErrorMessage(error));
    }
  }

  if (verifying) {
    return (
      <VerifyEmail
        email={email}
        onResend={sendCode}
        onVerified={async () => {
          const { error } = await attempt(() => authClient.signIn.email({ email, password }));
          if (error) {
            setVerifying(false);
            return setError(authErrorMessage(error));
          }
          done();
        }}
      />
    );
  }

  const signUp = mode === 'sign-up';
  const other = signUp ? '/sign-in' : '/sign-up';
  const otherHref = redirect === '/' ? other : `${other}?redirect=${encodeURIComponent(redirect)}`;

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium tracking-tight">
        {signUp ? 'Start your briefing' : 'Welcome back'}
      </h1>
      <p className="mt-2 text-ink-muted">
        {signUp
          ? 'Create an account to choose your beats.'
          : 'Sign in to read your latest briefings.'}
      </p>

      <Button
        variant="secondary"
        className="mt-8 w-full"
        onClick={google}
        busy={busy === 'google'}
        disabled={busy !== null}
      >
        {busy !== 'google' && <GoogleIcon />}
        Continue with Google
      </Button>

      <div className="my-6 flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-rule" />
        or with email
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
        {signUp && (
          <Field
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
          />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={signUp ? 'new-password' : 'current-password'}
          required
          minLength={8}
          hint={signUp ? 'At least 8 characters.' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Notice>{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy === 'email'} disabled={busy !== null}>
          {signUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-muted">
        {signUp ? 'Already have an account? ' : 'New to Panorist? '}
        <Link href={otherHref} className="font-medium text-ink underline underline-offset-4">
          {signUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </div>
  );
}

function VerifyEmail({
  email,
  onResend,
  onVerified,
}: {
  email: string;
  onResend: () => Promise<void>;
  onVerified: () => Promise<void>;
}) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await attempt(() => authClient.emailOtp.verifyEmail({ email, otp }));
    if (error) {
      setBusy(false);
      return setError(authErrorMessage(error));
    }
    await onVerified();
    setBusy(false);
  }

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium tracking-tight">Check your inbox</h1>
      <p className="mt-2 text-ink-muted">
        We sent a verification code to <span className="font-medium text-ink">{email}</span>.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field
          label="Verification code"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={otp}
          onChange={(e) => setOtp(e.target.value.trim())}
        />
        {error && <Notice>{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Verify and continue
        </Button>
      </form>
      <button
        type="button"
        className="mt-6 text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        onClick={async () => {
          await onResend();
          setResent(true);
        }}
      >
        {resent ? 'Code sent again' : 'Resend code'}
      </button>
    </div>
  );
}
