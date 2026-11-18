/**
 * Android: the app is installed from GitHub releases (APK), so it checks for a
 * newer release and opens the installer. iOS updates come from the App Store.
 */
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { RELEASES_URL } from './config';
import { isNewerVersion } from './jobLogic';

export type UpdateCheck = { status: 'latest' } | { status: 'available'; version: string; apkUrl: string } | { status: 'error'; message: string };

export const currentVersion = Constants.expoConfig?.version ?? '0.0.0';

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (Platform.OS !== 'android') return { status: 'latest' };
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const data = await res.json();
    const apk = (data.assets ?? []).find((a: any) => typeof a.name === 'string' && a.name.endsWith('.apk'));
    if (!data.tag_name || !apk || !isNewerVersion(data.tag_name, currentVersion)) return { status: 'latest' };
    if (!/^https:\/\/github\.com\//.test(apk.browser_download_url)) throw new Error('Unexpected download address');
    return { status: 'available', version: String(data.tag_name), apkUrl: apk.browser_download_url };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Update check failed' };
  }
}

export async function installUpdate(apkUrl: string) {
  const target = new File(Paths.cache, 'FunPrintingPartner-update.apk');
  const file = await File.downloadFileAsync(apkUrl, target, { idempotent: true });
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
