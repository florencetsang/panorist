import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { initials } from '@panorist/core/format';
import { useSession } from '../auth/session.tsx';
import { API_URL } from '../lib/config.ts';
import { Button, Rule, Text } from '../ui/primitives.tsx';
import { font, space, useTheme } from '../ui/theme.ts';

export function AccountScreen() {
  const { session, signOut, deleteAccount } = useSession();
  const { color } = useTheme();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const user = session?.user;
  const display = user?.name || user?.email || '';

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          await signOut();
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'Your account, preferences and every briefing will be permanently deleted. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
            } catch {
              setDeleting(false);
              Alert.alert('Couldn’t delete your account', 'Check your connection and try again.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView contentContainerStyle={{ padding: space(5), gap: space(8) }}>
        <View style={{ gap: space(2) }}>
          <Text variant="eyebrow" tone="accent">
            Account
          </Text>
          <Text variant="display">You</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: color.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text tone="paper" style={{ fontFamily: font.sansSemibold, fontSize: 18 }}>
              {display ? initials(display) : ''}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            {user?.name && <Text variant="heading">{user.name}</Text>}
            <Text tone="muted">{user?.email}</Text>
          </View>
        </View>

        <View>
          <Rule strong />
          <Row label="Appearance" value="Follows your device" />
          <Rule />
          <Row
            label="Open Panorist on the web"
            value="↗"
            onPress={() => void WebBrowser.openBrowserAsync(API_URL)}
          />
          <Rule />
          <Row label="Version" value={Constants.expoConfig?.version ?? '—'} />
          <Rule />
        </View>

        <View style={{ gap: space(3) }}>
          <Button
            variant="secondary"
            label="Sign out"
            onPress={confirmSignOut}
            busy={busy}
            disabled={deleting}
          />
          <Button
            variant="ghost"
            label="Delete account"
            onPress={confirmDelete}
            busy={deleting}
            disabled={busy}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: space(4),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text>{label}</Text>
      <Text tone="muted">{value}</Text>
    </Pressable>
  );
}
