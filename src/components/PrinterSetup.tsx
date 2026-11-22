/**
 * Settings: the phone's printers. Each printer has an on/off switch; every order file goes to a
 * switched-on printer that can print it (colour, double-sided, A3). Printers are found on the
 * Wi-Fi, typed in by address, chosen from AirPrint (iOS) or the system print dialog.
 */
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Banner, Body, Button, Card, Field, Pill, Section, SwitchRow } from '@/components/ui';
import type { FoundPrinter } from '@/lib/discovery';
import { canSearch, findPrinters } from '@/lib/findPrinters';
import { chooseAirPrintPrinter, checkIppPrinter, printFile } from '@/lib/printers';
import type { IppPrinter, PrinterEntry } from '@/lib/printerModel';
import { changePrinterDpi, changePrinterReverseOrder, preferForBw, removePrinter, savePrinter, settingsStore, switchPrinter } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { space } from '@/theme';

type Message = { tone: 'success' | 'danger' | 'info'; title: string; text?: string };

function abilities(p: PrinterEntry): string {
  if (p.kind === 'dialog') return 'Asks you to confirm each file';
  if (p.kind === 'airprint') return 'AirPrint · uses the printer\'s own settings';
  const isRaster = !p.formats.includes('application/pdf') && p.formats.includes('image/pwg-raster');
  const dpiText = p.kind === 'ipp' ? `${p.dpi || 300} DPI` : '';
  const orderText = p.kind === 'ipp' && p.reverseOrder === false ? '1→N' : 'LIFO';
  const out = [
    p.colorModes.length ? (p.colorModes.includes('color') ? 'Colour' : 'B&W only') : '',
    p.sides.length ? (p.sides.some((s) => s.startsWith('two-sided')) ? 'Double-sided' : 'Single-sided') : '',
    p.media.includes('iso_a3_297x420mm') ? 'A3' : '',
    isRaster ? `Direct Host (${dpiText} · ${orderText})` : dpiText,
  ];
  return out.filter(Boolean).join(' · ') || 'Wi-Fi';
}

/** Reads a printer's properties over IPP and returns the entry to save, or explains why not. */
async function readPrinter(address: string, uuid?: string): Promise<{ entry: IppPrinter } | { error: Message }> {
  const { summary, caps, uuid: reported, urls } = await checkIppPrinter(address);
  const supportsPdf = caps.formats.includes('application/pdf');
  const supportsPwg = caps.formats.includes('image/pwg-raster');

  if (!supportsPdf && !supportsPwg) {
    return {
      error: {
        tone: 'danger',
        title: `${summary.name} format unsupported`,
        text: 'This printer cannot process raw PDFs or PWG raster over IPP. Tap "Use the system print dialog" below to print to it using Android\'s print service, or print from your shop computer.',
      },
    };
  }
  const id = uuid || reported || urls.ipp;
  return { entry: { kind: 'ipp', id, uuid: uuid || reported, name: summary.name, address: urls.ipp, enabled: true, preferredBw: false, ...caps } };
}

export default function PrinterSetup() {
  const { printers } = useStore(settingsStore);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<FoundPrinter[]>([]);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState<Message>();

  const known = (f: FoundPrinter) => printers.some((p) => p.kind === 'ipp' && ((f.uuid && p.uuid === f.uuid) || p.address === f.address));
  const fresh = found.filter((f) => !known(f));

  const search = async () => {
    setBusy('search');
    setMessage(undefined);
    try {
      setFound(await findPrinters());
      setSearched(true);
    } catch (err) {
      setMessage({ tone: 'danger', title: 'Search failed', text: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const connect = async (addr: string, uuid?: string, key = 'manual', printerName?: string) => {
    setBusy(key);
    setMessage(undefined);
    const addAsSystemPrint = (suggestedName?: string) => {
      const name = suggestedName ? `${suggestedName} (Wi-Fi)` : 'Wi-Fi Printer';
      savePrinter({ kind: 'dialog', id: uuid || key, name, enabled: true, preferredBw: false });
      setMessage({ tone: 'success', title: `${name} is ready`, text: 'Orders will print using Android print service over Wi-Fi' });
    };

    try {
      const r = await readPrinter(addr, uuid);
      if ('error' in r) {
        Alert.alert(
          `${printerName || 'Wi-Fi Printer'} setup`,
          `${r.error.title}\n\n${r.error.text}\n\nWould you like to add it using the Android Print Service?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add with System Print', onPress: () => addAsSystemPrint(printerName) },
          ]
        );
        return setMessage(r.error);
      }
      savePrinter(r.entry);
      setMessage({ tone: 'success', title: `${r.entry.name} is ready`, text: abilities(r.entry) });
      if (key === 'manual') setAddress('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('426') || msg.includes('requires Android') || msg.includes('secure connections') || msg.includes('raster')) {
        Alert.alert(
          `${printerName || 'Wi-Fi Printer'} setup`,
          `This printer uses Epson/host raster printing.\n\nWould you like to add it using Android System Print to print over Wi-Fi?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add with System Print', onPress: () => addAsSystemPrint(printerName) },
          ]
        );
      }
      setMessage({ tone: 'danger', title: 'Printer setup notice', text: msg });
    } finally {
      setBusy(null);
    }
  };

  const chooseAirPrint = async () => {
    try {
      const p = await chooseAirPrintPrinter();
      savePrinter({ kind: 'airprint', id: p.url, name: p.name, url: p.url, enabled: true, preferredBw: false });
      setMessage({ tone: 'success', title: `Using ${p.name}` });
    } catch {
      // closed the picker
    }
  };

  const testPage = async (printer: PrinterEntry) => {
    setBusy(`test:${printer.id}`);
    setMessage(undefined);
    try {
      const { uri } = await Print.printToFileAsync({
        html: `<html><body style="font-family:sans-serif;padding:48px"><h1>FunPrinting test page</h1><p>${printer.name}</p><p>If you can read this, this phone can print your shop's orders.</p><p>${new Date().toLocaleString()}</p></body></html>`,
        width: 595,
        height: 842,
      });
      await printFile(printer, new File(uri), { url: uri, printUrl: uri, name: 'test.pdf', copies: 1 }, 'FunPrinting test page', () => undefined);
      setMessage({ tone: 'success', title: 'Test page sent', text: printer.name });
    } catch (err) {
      setMessage({ tone: 'danger', title: 'Test page failed', text: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const enabledCount = printers.filter((p) => p.enabled).length;

  return (
    <>
      <Section
        title="Printers"
        footer={
          Platform.OS === 'ios'
            ? 'Switch on every printer this shop uses. Each file goes to one that can print it. AirPrint printers use their own colour and double-sided settings.'
            : 'Switch on every printer this shop uses. Each file goes to a printer that can print it (colour, double-sided, A3). The phone and printers must be on the same Wi-Fi.'
        }
      >
        <Card>
          {printers.length === 0 ? <Body tone="tertiary">No printer yet. Search for Wi-Fi printers below.</Body> : null}
          {printers.map((p, i) => (
            <View key={p.id} style={{ gap: space.sm }}>
              <SwitchRow first={i === 0} title={p.name} subtitle={abilities(p)} value={p.enabled} onValueChange={(on) => switchPrinter(p.id, on)} />
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                <Button variant="secondary" title="Test page" onPress={() => testPage(p)} loading={busy === `test:${p.id}`} />
                {p.enabled && enabledCount > 1 && (p.kind !== 'ipp' || p.colorModes.includes('color')) ? (
                  <Button variant="secondary" title={p.preferredBw ? 'Preferred for B&W ✓' : 'Prefer for B&W'} onPress={() => preferForBw(p.id, !p.preferredBw)} />
                ) : null}
                <Button variant="plain" title="Remove" onPress={() => removePrinter(p.id)} />
              </View>
              {p.kind === 'ipp' && (p.formats.includes('image/pwg-raster') || !p.formats.includes('application/pdf')) ? (
                <View style={{ gap: space.xs, marginTop: 4 }}>
                  <Body tone="secondary">Print Resolution (DPI)</Body>
                  <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
                    {([
                      { val: 200, label: '200 Draft' },
                      { val: 300, label: '300 Normal' },
                      { val: 600, label: '600 High' },
                    ] as const).map((opt) => {
                      const isSelected = (p.dpi || 300) === opt.val;
                      return (
                        <Button
                          key={opt.val}
                          variant={isSelected ? 'primary' : 'secondary'}
                          title={isSelected ? `${opt.label} ✓` : opt.label}
                          onPress={() => changePrinterDpi(p.id, opt.val)}
                        />
                      );
                    })}
                  </View>
                  <SwitchRow
                    title="LIFO stack order (Page N to 1)"
                    subtitle="Prints last page first so Page 1 lands on top of face-up output trays"
                    value={p.reverseOrder !== false}
                    onValueChange={(on) => changePrinterReverseOrder(p.id, on)}
                  />
                </View>
              ) : null}
            </View>
          ))}
          {message ? <Banner tone={message.tone} title={message.title} message={message.text} /> : null}
        </Card>
      </Section>

      <Section title="Add a printer" footer="Search finds Wi-Fi printers on your local network. Important: If a VPN or Private DNS is active on this phone, turn it off so local Wi-Fi devices (192.168.x.x) can be reached.">
        <Card>
          {canSearch ? <Button variant="secondary" title={searched ? 'Search again' : 'Find Wi-Fi printers'} onPress={search} loading={busy === 'search'} /> : <Body tone="tertiary">Searching needs the installed app (it is not available in Expo Go).</Body>}
          {searched && fresh.length === 0 && busy !== 'search' ? <Body tone="tertiary">No new printers found. Check the printer is on and on this Wi-Fi.</Body> : null}
          {fresh.map((f) => (
            <View key={f.id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Body tone="primary">{f.name}</Body>
                  <Body tone="tertiary">{f.secureOnly ? 'Only offers a secure connection this phone cannot use' : (f.addresses[0] ?? 'Wi-Fi')}</Body>
                </View>
                {f.announced.color !== undefined ? <Pill label={f.announced.color ? 'Colour' : 'B&W'} /> : null}
              </View>
              <Button variant="secondary" title="Add" onPress={() => f.address && connect(f.address, f.uuid, f.id, f.name)} loading={busy === f.id} disabled={!f.address || busy !== null} />
            </View>
          ))}
          <Field label="Printer address" placeholder="192.168.1.20" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={address} onChangeText={setAddress} hint="Shown on the printer's network settings page or its printed network report." />
          <Button variant="secondary" title="Connect" onPress={() => connect(address)} loading={busy === 'manual'} disabled={!address.trim() || busy !== null} />
          {Platform.OS === 'ios' ? <Button variant="secondary" title="Choose an AirPrint printer" icon={{ ios: 'printer', android: 'print' }} onPress={chooseAirPrint} /> : null}
          <Button variant="plain" title="Use the system print dialog" onPress={() => savePrinter({ kind: 'dialog', id: 'dialog', name: 'System print dialog', enabled: true, preferredBw: false })} />
        </Card>
      </Section>
    </>
  );
}
