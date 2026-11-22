/**
 * The printers a phone prints on, and how they map to the router. No React Native imports
 * (tested with node --test).
 */
import type { RouterPrinter } from './router.ts';

type Base = { id: string; name: string; enabled: boolean; preferredBw: boolean };
export type IppPrinter = Base & {
  kind: 'ipp';
  /** What the shop typed or search found: "192.168.1.20", "printer.local" or a full ipp:// URL. */
  address: string;
  /** The printer's own id (printer-uuid), so it can be found again after its address changes. */
  uuid?: string;
  /** Its .local name, which keeps working when the IP address changes. */
  host?: string;
  formats: string[];
  sides: string[];
  colorModes: string[];
  media: string[];
};
export type AirPrintPrinter = Base & { kind: 'airprint'; url: string };
export type DialogPrinter = Base & { kind: 'dialog' };
export type PrinterEntry = IppPrinter | AirPrintPrinter | DialogPrinter;

export type Settings = { mode: 'companion' | 'station'; printers: PrinterEntry[] };

export const DEFAULT_SETTINGS: Settings = { mode: 'companion', printers: [] };

const A3 = 'iso_a3_297x420mm';

/** Stable id for an entry: the printer's uuid, else its address. */
export function entryId(p: { kind: string; uuid?: string; address?: string; url?: string }) {
  if (p.kind === 'dialog') return 'dialog';
  return p.uuid || p.address || p.url || p.kind;
}

/** What the router needs to know about an entry. Empty lists mean "the printer didn't say". */
export function routerPrinter(p: PrinterEntry): RouterPrinter {
  if (p.kind !== 'ipp') return { id: p.id, name: p.name, enabled: p.enabled, preferredBw: p.preferredBw };
  return {
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    preferredBw: p.preferredBw,
    caps: {
      pdf: p.formats.length ? p.formats.includes('application/pdf') : undefined,
      color: p.colorModes.length ? p.colorModes.includes('color') : undefined,
      duplex: p.sides.length ? p.sides.some((s) => s.startsWith('two-sided')) : undefined,
      a3: p.media.length ? p.media.includes(A3) : undefined,
    },
  };
}

/** Settings saved by an earlier version had one `printer`; it becomes the first entry. */
export function migrateSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { mode?: unknown; printers?: unknown; printer?: any };
  const mode = r.mode === 'station' ? 'station' : 'companion';
  if (Array.isArray(r.printers)) return { mode, printers: r.printers as PrinterEntry[] };
  const old = r.printer;
  if (!old || typeof old !== 'object' || !old.kind) return { mode, printers: [] };
  const entry = { ...old, enabled: true, preferredBw: false } as PrinterEntry;
  entry.id = entryId(entry as any);
  if (entry.kind === 'dialog') entry.name = 'System print dialog';
  return { mode, printers: [entry] };
}

/** Add or replace the entry with the same id, keeping what the shop chose (on/off, B&W). */
export function upsertPrinter(list: PrinterEntry[], next: PrinterEntry): PrinterEntry[] {
  const i = list.findIndex((p) => p.id === next.id || (next.kind === 'ipp' && p.kind === 'ipp' && next.uuid && p.uuid === next.uuid));
  if (i < 0) return [...list, next];
  const keep = list[i];
  const merged = { ...next, id: keep.id, enabled: keep.enabled, preferredBw: keep.preferredBw } as PrinterEntry;
  return list.map((p, k) => (k === i ? merged : p));
}

/** Only one printer is "preferred for B&W". */
export function setPreferredBw(list: PrinterEntry[], id: string, on: boolean): PrinterEntry[] {
  return list.map((p) => ({ ...p, preferredBw: p.id === id ? on && p.enabled : on ? false : p.preferredBw }));
}

export function setEnabled(list: PrinterEntry[], id: string, on: boolean): PrinterEntry[] {
  return list.map((p) => (p.id === id ? { ...p, enabled: on, preferredBw: on ? p.preferredBw : false } : p));
}

/** A one-line label for what was used, for "Printed on <phone> · <printer>". */
export function printerLabel(p: PrinterEntry | null | undefined): string | undefined {
  if (!p) return undefined;
  return p.kind === 'dialog' ? 'System print dialog' : p.name || undefined;
}
