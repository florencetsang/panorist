import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '../src/auth/session.tsx';
import { FONT_ASSETS } from '../src/ui/fonts.ts';
import { useTheme } from '../src/ui/theme.ts';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Navigator ready={fontsLoaded || fontError !== null} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Navigator({ ready }: { ready: boolean }) {
  const { status } = useSession();
  const { color, dark } = useTheme();
  const loaded = ready && status !== 'loading';

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}>
        <Stack.Protected guard={status === 'signed-in'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signed-out'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
