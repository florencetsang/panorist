import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  authMessage,
  isUnverified,
  sendVerificationCode,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  verifyEmail,
} from '../auth/client.ts';
import { useSession } from '../auth/session.tsx';
import { Button, Field, Notice, Rule, Text, Wordmark } from '../ui/primitives.tsx';
import { font, space, useTheme } from '../ui/theme.ts';

type Mode = 'sign-in' | 'sign-up';
type Busy = null | 'email' | 'google' | 'verify' | 'resend';

export function AuthScreen({ mode }: { mode: Mode }) {
  const { setSession } = useSession();
  const { color } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const isSignUp = mode === 'sign-up';

  async function run(kind: Busy, task: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function startVerification() {
    await sendVerificationCode(email.trim());
    setVerifying(true);
  }

  const submit = () =>
    run('email', async () => {
      const address = email.trim();
      try {
        if (isSignUp) {
          const session = await signUpWithEmail(
            name.trim() || address.split('@')[0],
            address,
            password,
          );
          if (session) return setSession(session);
          // No session: Neon Auth has already emailed a code; another would replace it.
          return setVerifying(true);
        }
        setSession(await signInWithEmail(address, password));
      } catch (err) {
        if (isUnverified(err)) return startVerification();
        throw err;
      }
    });

  const google = () =>
    run('google', async () => {
      const session = await signInWithGoogle();
      if (session) setSession(session);
    });

  if (verifying) {
    return (
      <VerifyEmail
        email={email.trim()}
        busy={busy}
        error={error}
        onBack={() => setVerifying(false)}
        onResend={() => run('resend', () => sendVerificationCode(email.trim()))}
        onVerify={(code) =>
          run('verify', async () => {
            await verifyEmail(email.trim(), code);
            setSession(await signInWithEmail(email.trim(), password));
          })
        }
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.paper }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, padding: space(6), gap: space(6) }}
        >
          <View style={{ marginTop: space(6), gap: space(3) }}>
            <Wordmark size={34} />
            <Rule strong />
            <Text variant="display">
              {isSignUp ? 'Start your morning edition.' : 'Welcome back.'}
            </Text>
            <Text variant="ui" tone="muted">
              {isSignUp
                ? 'Pick your beats once. Panorist reads the world and writes you a briefing every day.'
                : 'Sign in to read today’s briefing.'}
            </Text>
          </View>

          {error && <Notice>{error}</Notice>}

          <Button
            variant="secondary"
            label="Continue with Google"
            onPress={google}
            busy={busy === 'google'}
            disabled={busy !== null}
            icon={<Text style={{ fontFamily: font.sansSemibold, color: '#4285F4' }}>G</Text>}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Rule style={{ flex: 1 }} />
            <Text variant="small" tone="faint">
              or with email
            </Text>
            <Rule style={{ flex: 1 }} />
          </View>

          <View style={{ gap: space(4) }}>
            {isSignUp && (
              <Field
                label="Name"
                value={name}
                onChangeText={setName}
                autoComplete="name"
                textContentType="name"
                placeholder="How should we greet you?"
              />
            )}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              hint={isSignUp ? 'At least 8 characters.' : undefined}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Button
              label={isSignUp ? 'Create account' : 'Sign in'}
              onPress={submit}
              busy={busy === 'email'}
              disabled={busy !== null || !email.trim() || password.length === 0}
            />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space(1.5) }}>
            <Text tone="muted">{isSignUp ? 'Already have an account?' : 'New to Panorist?'}</Text>
            <Link href={isSignUp ? '/sign-in' : '/sign-up'} replace asChild>
              <Pressable accessibilityRole="link">
                <Text tone="accent" style={{ fontFamily: font.sansMedium }}>
                  {isSignUp ? 'Sign in' : 'Create an account'}
                </Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function VerifyEmail({
  email,
  busy,
  error,
  onBack,
  onResend,
  onVerify,
}: {
  email: string;
  busy: Busy;
  error: string | null;
  onBack: () => void;
  onResend: () => void;
  onVerify: (code: string) => void;
}) {
  const { color } = useTheme();
  const [code, setCode] = useState('');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space(6), gap: space(6) }}
      >
        <View style={{ marginTop: space(6), gap: space(3) }}>
          <Text variant="eyebrow" tone="accent">
            One more step
          </Text>
          <Text variant="title">Check your inbox</Text>
          <Text tone="muted">
            We sent a 6-digit code to {email}. Enter it to verify your email.
          </Text>
        </View>
        {error && <Notice>{error}</Notice>}
        <Field
          label="Verification code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          placeholder="123456"
          style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
        />
        <Button
          label="Verify and continue"
          onPress={() => onVerify(code)}
          busy={busy === 'verify'}
          disabled={busy !== null || code.length < 6}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Button variant="ghost" label="Back" onPress={onBack} disabled={busy !== null} />
          <Button
            variant="ghost"
            label="Send a new code"
            onPress={onResend}
            busy={busy === 'resend'}
            disabled={busy !== null}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
