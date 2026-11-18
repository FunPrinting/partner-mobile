import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Banner, Button, Card, Field, Row, Screen, Section, SwitchRow } from '@/components/ui';
import { WEB_URL } from '@/lib/config';
import { connectionStore, sendRemoteControl } from '@/lib/connection';
import { chooseAirPrintPrinter, checkIppPrinter, printFile } from '@/lib/printers';
import { releaseCurrent, stationStore } from '@/lib/printStation';
import { signOut } from '@/lib/session';
import { settingsStore, updateSettings, type PrinterSetting } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { checkForUpdate, currentVersion, installUpdate } from '@/lib/updates';
import { space } from '@/theme';

function printerLabel(p: PrinterSetting | null) {
  if (!p) return 'Not set';
  if (p.kind === 'dialog') return 'System print dialog';
  return p.name;
}

function PrinterSetup() {
  const { printer } = useStore(settingsStore);
  const [address, setAddress] = useState(printer?.kind === 'ipp' ? printer.address : '');
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; title: string; text?: string }>();

  const checkIpp = async () => {
    setChecking(true);
    setMessage(undefined);
    try {
      const { summary, caps } = await checkIppPrinter(address);
      if (!caps.formats.includes('application/pdf')) {
        setMessage({ tone: 'danger', title: `${summary.name} can't take PDFs over Wi-Fi`, text: 'Use the system print dialog instead, or print from the desktop app.' });
        return;
      }
      updateSettings({ printer: { kind: 'ipp', address: address.trim(), name: summary.name, ...caps } });
      const extras = [caps.sides.some((s) => s.startsWith('two-sided')) ? 'double-sided' : 'single-sided only', caps.colorModes.includes('color') ? 'colour' : 'B&W only'];
      setMessage({ tone: 'success', title: `Connected to ${summary.name}`, text: `${summary.state === 'idle' ? 'Ready' : `Printer is ${summary.state}`} · ${extras.join(' · ')}` });
    } catch (err) {
      setMessage({ tone: 'danger', title: 'Printer not found', text: err instanceof Error ? err.message : undefined });
    } finally {
      setChecking(false);
    }
  };

  const chooseAirPrint = async () => {
    try {
      const p = await chooseAirPrintPrinter();
      updateSettings({ printer: { kind: 'airprint', ...p } });
      setMessage({ tone: 'success', title: `Using ${p.name}` });
    } catch {
      // closed the picker
    }
  };

  const testPage = async () => {
    if (!printer) return;
    setTesting(true);
    try {
      const { uri } = await Print.printToFileAsync({
        html: `<html><body style="font-family:sans-serif;padding:48px"><h1>FunPrinting test page</h1><p>If you can read this, this phone can print your shop's orders.</p><p>${new Date().toLocaleString()}</p></body></html>`,
        width: 595,
        height: 842,
      });
      await printFile(printer, new File(uri), { url: uri, name: 'test.pdf', mime: 'application/pdf', copies: 1 }, 'FunPrinting test page', () => undefined);
      setMessage({ tone: 'success', title: 'Test page sent' });
    } catch (err) {
      setMessage({ tone: 'danger', title: 'Test page failed', text: err instanceof Error ? err.message : undefined });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title="Printer"
      footer={
        Platform.OS === 'ios'
          ? 'AirPrint prints without a dialog. iOS uses the printer\'s own colour and double-sided settings, so jobs that need them are best printed from the desktop app.'
          : 'Wi-Fi printing sends each file straight to the printer with the right copies, colour, sides and paper size. The phone and printer must be on the same Wi-Fi.'
      }
    >
      <Card>
        <Row first title="Current printer" value={printerLabel(printer)} />
        {Platform.OS === 'ios' ? (
          <Button variant="secondary" title={printer?.kind === 'airprint' ? 'Choose another AirPrint printer' : 'Choose AirPrint printer'} icon={{ ios: 'printer', android: 'print' }} onPress={chooseAirPrint} />
        ) : (
          <View style={{ gap: space.sm }}>
            <Field
              label="Wi-Fi printer address"
              placeholder="192.168.1.20"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={address}
              onChangeText={setAddress}
              hint="Find it on the printer's network settings page or its printed network report."
            />
            <Button variant="secondary" title="Connect" onPress={checkIpp} loading={checking} disabled={!address.trim()} />
          </View>
        )}
        <Button variant="plain" title="Use the system print dialog instead" onPress={() => updateSettings({ printer: { kind: 'dialog' } })} />
        {message ? <Banner tone={message.tone} title={message.title} message={message.text} /> : null}
        {printer ? <Button variant="secondary" title="Print a test page" onPress={testPage} loading={testing} /> : null}
      </Card>
    </Section>
  );
}

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
            ? 'Prints orders while the app is open, one at a time, sharing the queue with your other devices. Keep the phone on charge; the screen stays on while printing.'
            : 'You see orders and can accept them; your desktop app prints them.'
        }
      >
        <Card>
          <SwitchRow first title="Print station" subtitle="Print orders from this phone" value={settings.mode === 'station'} onValueChange={setStation} />
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
