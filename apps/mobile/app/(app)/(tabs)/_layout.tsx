import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { useFeatures } from '../../../src/lib/features.ts';
import { font, useTheme } from '../../../src/ui/theme.ts';

export default function TabsLayout() {
  const { color } = useTheme();
  const { has } = useFeatures();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.paper },
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.inkFaint,
        tabBarStyle: {
          backgroundColor: color.paper,
          borderTopColor: color.rule,
        },
        tabBarLabelStyle: { fontFamily: font.sansMedium, fontSize: 12 },
        tabBarIcon: ({ focused }) => (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: focused ? color.accent : 'transparent',
            }}
          />
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Briefings' }} />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', href: has('insight_library') ? undefined : null }}
      />
      <Tabs.Screen name="preferences" options={{ title: 'Preferences' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
