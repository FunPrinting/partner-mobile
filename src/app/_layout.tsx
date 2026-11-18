import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useAppServices } from '@/lib/services';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const session = useAppServices();
  const { colors } = useTheme();

  if (session.status === 'loading') return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const signedIn = session.status === 'signed-in';
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
