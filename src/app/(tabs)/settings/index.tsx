import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { requestNotificationPermission } from '../../../../modules/printer-discovery';
import PrinterSetup from '@/components/PrinterSetup';
import { Button, Card, Row, Screen, Section, SwitchRow } from '@/components/ui';
import { WEB_URL } from '@/lib/config';
import { connectionStore, sendRemoteControl } from '@/lib/connection';
import { releaseCurrent, stationStore } from '@/lib/printStation';
import { signOut } from '@/lib/session';
import { settingsStore, updateSettings } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { checkForUpdate, currentVersion, installUpdate } from '@/lib/updates';
import { space } from '@/theme';

export default function SettingsScreen() {
  const settings = useStore(settingsStore);
  const station = useStore(stationStore);
  const { connected } = useStore(connectionStore);
  const [update, setUpdate] = useState<string>();
  const [updating, setUpdating] = useState(false);

  const setStation = (on: boolean) => {
    if (!on && station.current) {
      Alert.alert('A job is printing', 'Turn off the print station after it finishes, or sign out to hand it back.');
      return;
    }
    updateSettings({ mode: on ? 'station' : 'companion' });
  };

  const remote = (action: 'pause' | 'resume') => {
    if (!sendRemoteControl(action)) Alert.alert('Not connected', 'Check your internet connection and try again.');
    else Alert.alert(action === 'pause' ? 'Pause sent' : 'Resume sent', 'Your desktop app will follow in a moment.');
  };

  const onUpdate = async () => {
    setUpdating(true);
    const r = await checkForUpdate();
    setUpdating(false);
    if (r.status === 'latest') setUpdate('You have the latest version.');
    else if (r.status === 'error') setUpdate(`Update check failed: ${r.message}`);
    else
      Alert.alert(`Update ${r.version} is available`, 'Download and install it now?', [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Install',
          onPress: async () => {
            setUpdating(true);
            try {
              await installUpdate(r.apkUrl);
            } catch (err) {
              setUpdate(`Download failed: ${err instanceof Error ? err.message : 'unknown error'}`);
            } finally {
              setUpdating(false);
            }
          },
        },
      ]);
  };

  const onSignOut = () => {
    Alert.alert('Sign out this phone?', station.current ? 'The job printing now goes back to your shop\'s queue.' : 'You can sign in again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await releaseCurrent();
          await signOut();
        },
      },
    ]);
  };

  return (
    <Screen>
      <Section
        title="This phone"
        footer={
          settings.mode === 'station'
            ? settings.runInBackground
              ? 'Prints orders in the background even when minimized. A notification stays in your status bar while active.'
              : 'Prints orders while the app is open, one at a time, sharing the queue with your other devices. Keep the phone on charge; the screen stays on while printing.'
            : 'You see orders and can accept them; your desktop app prints them.'
        }
      >
        <Card>
          <SwitchRow first title="Print station" subtitle="Print orders from this phone" value={settings.mode === 'station'} onValueChange={setStation} />
          {settings.mode === 'station' ? (
            <>
              <SwitchRow
                title="Keep running in background"
                subtitle="Continue checking orders and printing when minimized"
                value={Boolean(settings.runInBackground)}
                onValueChange={async (on) => {
                  if (on && Platform.OS === 'android') {
                    await requestNotificationPermission().catch(() => undefined);
                  }
                  updateSettings({ runInBackground: on });
                }}
              />
              <SwitchRow
                title="Print order summary slip"
                subtitle="Prints an order ticket on top of the tray when finished"
                value={settings.summarySlip !== false}
                onValueChange={(on) => updateSettings({ summarySlip: on })}
              />
            </>
          ) : null}
        </Card>
      </Section>

      {settings.mode === 'station' ? <PrinterSetup /> : null}

      <Section title="Desktop app" footer="Pauses or resumes printing on your shop's computer.">
        <Card>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button variant="secondary" title="Pause" icon={{ ios: 'pause.fill', android: 'pause' }} onPress={() => remote('pause')} disabled={!connected} style={{ flex: 1 }} />
            <Button variant="secondary" title="Resume" icon={{ ios: 'play.fill', android: 'play_arrow' }} onPress={() => remote('resume')} disabled={!connected} style={{ flex: 1 }} />
          </View>
        </Card>
      </Section>

      <Section title="Account">
        <Card>
          <Row first title="Signed-in devices" subtitle="See and sign out your shop's apps" onPress={() => WebBrowser.openBrowserAsync(`${WEB_URL}/partner/dashboard`)} />
          <Row title="Help and contact" onPress={() => WebBrowser.openBrowserAsync(`${WEB_URL}/contact`)} />
        </Card>
      </Section>

      <Section title="App" footer={update}>
        <Card>
          <Row first title="Version" value={currentVersion} />
          {Platform.OS === 'android' ? <Button variant="secondary" title="Check for updates" onPress={onUpdate} loading={updating} /> : null}
        </Card>
      </Section>

      <Button variant="destructive" title="Sign out" onPress={onSignOut} />
    </Screen>
  );
}
