import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { useTheme } from '@/theme';

/** Native stack header with a large, collapsing title (iOS) inside each tab. */
export function TabStack({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: Platform.OS === 'ios',
        headerTransparent: Platform.OS === 'ios',
        headerShadowVisible: false,
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerLargeTitleStyle: { color: colors.text },
        headerStyle: Platform.OS === 'android' ? { backgroundColor: colors.background } : undefined,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
