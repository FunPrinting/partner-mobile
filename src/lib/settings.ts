/**
 * This phone's role and printers. Stored on the device only.
 *
 * - companion (default): see and accept orders, update statuses, control the
 *   desktop app. Prints nothing.
 * - station: also takes print jobs and prints them on the shop's printers while
 *   the app is open. Each file goes to a switched-on printer that can print it.
 */
import { DEFAULT_SETTINGS, migrateSettings, setEnabled, setPreferredBw, setPrinterDpi, setPrinterReverseOrder, setPrinterScaling, upsertPrinter, type PrinterEntry, type Settings } from './printerModel';
import { readJson, writeJson } from './storage';
import { createStore } from './store';

export type { AirPrintPrinter, DialogPrinter, IppPrinter, PrinterEntry, Settings } from './printerModel';

export const settingsStore = createStore<Settings>(migrateSettings(readJson('settings', DEFAULT_SETTINGS)));

function save(patch: Partial<Settings>) {
  settingsStore.set(patch);
  writeJson('settings', settingsStore.get());
}

export function updateSettings(patch: Partial<Settings>) {
  save(patch);
}

/** Adds a printer, or refreshes one the phone already has (keeping its on/off and B&W choice). */
export function savePrinter(entry: PrinterEntry) {
  save({ printers: upsertPrinter(settingsStore.get().printers, entry) });
}

export function removePrinter(id: string) {
  save({ printers: settingsStore.get().printers.filter((p) => p.id !== id) });
}

export function switchPrinter(id: string, on: boolean) {
  save({ printers: setEnabled(settingsStore.get().printers, id, on) });
}

export function preferForBw(id: string, on: boolean) {
  save({ printers: setPreferredBw(settingsStore.get().printers, id, on) });
}

export function changePrinterDpi(id: string, dpi: 200 | 300 | 600) {
  save({ printers: setPrinterDpi(settingsStore.get().printers, id, dpi) });
}

export function changePrinterReverseOrder(id: string, reverseOrder: boolean) {
  save({ printers: setPrinterReverseOrder(settingsStore.get().printers, id, reverseOrder) });
}

export function changePrinterScaling(id: string, scaling: 'fit' | 'none') {
  save({ printers: setPrinterScaling(settingsStore.get().printers, id, scaling) });
}

export function setRunInBackground(on: boolean) {
  save({ runInBackground: on });
}

export function setSummarySlip(on: boolean) {
  save({ summarySlip: on });
}
