import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '@/theme';

/**
 * OAuth callback route — funprintingpartner://callback?code=...&state=...
 *
 * expo-web-browser's openAuthSessionAsync() intercepts this deep link and
 * returns the URL to the signIn() caller before this screen fully mounts.
 * This screen only shows momentarily if the deep link fires without an active
 * openAuthSessionAsync session (e.g. the user opens a stale link manually).
 * Calling maybeCompleteAuthSession() here covers that edge case.
 */
WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  const { colors } = useTheme();

  useEffect(() => {
    // maybeCompleteAuthSession is called at module level above.
    // Nothing else to do — the sign-in screen handles the result.
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
