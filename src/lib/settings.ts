/**
 * This phone's role and printer. Stored on the device only.
 *
 * - companion (default): see and accept orders, update statuses, control the
 *   desktop app. Prints nothing.
 * - station: also takes print jobs and prints them on the chosen printer while
 *   the app is open.
 */
import { readJson, writeJson } from './storage';
import { createStore } from './store';

export type PrinterSetting =
  | { kind: 'ipp'; address: string; name: string; formats: string[]; sides: string[]; colorModes: string[]; media: string[] }
  | { kind: 'airprint'; name: string; url: string }
  | { kind: 'dialog' };

export type Settings = { mode: 'companion' | 'station'; printer: PrinterSetting | null };

const DEFAULTS: Settings = { mode: 'companion', printer: null };

export const settingsStore = createStore<Settings>(readJson('settings', DEFAULTS));

export function updateSettings(patch: Partial<Settings>) {
  settingsStore.set(patch);
  writeJson('settings', settingsStore.get());
}
