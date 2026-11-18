import { Stack } from 'expo-router';

import { font, useTheme } from '../../src/ui/theme.ts';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: color.paper },
        headerStyle: { backgroundColor: color.paper },
        headerShadowVisible: false,
        headerTintColor: color.ink,
        headerTitleStyle: { fontFamily: font.sansMedium, fontSize: 15 },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="reports/[id]" options={{ title: '' }} />
    </Stack>
  );
}
