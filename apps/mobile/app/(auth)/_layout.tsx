import { Stack } from 'expo-router';

import { useTheme } from '../../src/ui/theme.ts';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: color.paper },
      }}
    />
  );
}
