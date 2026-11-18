import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Icon, type IconName } from '@/components/ui';
import { sessionStore, signIn } from '@/lib/session';
import { useStore } from '@/lib/store';
import { space, type, useTheme } from '@/theme';

const POINTS: { icon: IconName; text: string }[] = [
  { icon: { ios: 'bell.badge', android: 'notifications' }, text: 'See new orders and accept or decline them' },
  { icon: { ios: 'printer', android: 'print' }, text: 'Print on a Wi-Fi or AirPrint printer, or control your desktop app' },
  { icon: { ios: 'checkmark.seal', android: 'verified' }, text: 'Mark orders ready for pickup and delivered' },
];

export default function SignIn() {
  const { colors } = useTheme();
  const session = useStore(sessionStore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onSignIn = async () => {
    setBusy(true);
    setError(undefined);
    const result = await signIn();
    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <Image source={require('../../assets/logo.jpg')} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[type.largeTitle, { color: colors.text }]} accessibilityRole="header">
          FunPrinting Partner
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>Run your print shop from your phone.</Text>
        <View style={{ gap: space.lg, marginTop: space.xl }}>
          {POINTS.map((p) => (
            <View key={p.text} style={styles.point}>
              <Icon name={p.icon} size={22} color={colors.primary} />
              <Text style={[type.callout, { color: colors.text, flex: 1 }]}>{p.text}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: space.md }}>
        {error ? <Banner tone="danger" title="Sign-in failed" message={error} /> : session.message ? <Banner tone="info" title={session.message} /> : null}
        <Button title="Sign in with Google" onPress={onSignIn} loading={busy} icon={{ ios: 'person.crop.circle', android: 'account_circle' }} />
        <Text style={[type.footnote, { color: colors.textTertiary, textAlign: 'center' }]}>
          Use the Google account of your approved shop. Your browser opens to confirm.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space.xl, justifyContent: 'space-between' },
  top: { gap: space.sm, marginTop: space.xxl },
  logo: { width: 64, height: 64, borderRadius: 16, marginBottom: space.md },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
