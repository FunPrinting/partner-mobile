/**
 * Looking for Wi-Fi printers on the network, and finding a saved printer again when its
 * address changed. The Bonjour search is native (modules/printer-discovery); everything
 * else is in discovery.ts.
 */
import { isAvailable, scan } from '../../modules/printer-discovery';
import { mergeFound, relocate, type FoundPrinter } from './discovery';
import type { IppPrinter } from './printerModel';
import { savePrinter } from './settings';

export const canSearch = isAvailable;

/** Printers announcing themselves on the Wi-Fi right now. */
export async function findPrinters(timeoutMs = 4000): Promise<FoundPrinter[]> {
  return mergeFound(await scan(timeoutMs));
}

/**
 * The saved printer stopped answering: look for it on the network under another address
 * and save the new one. Returns the updated printer, or null when it is not found.
 */
export async function refindPrinter(saved: IppPrinter): Promise<IppPrinter | null> {
  if (!isAvailable) return null;
  const hit = relocate(saved, await findPrinters(3000));
  if (!hit?.address || hit.address === saved.address) return null;
  const next: IppPrinter = { ...saved, address: hit.address };
  savePrinter(next);
  return next;
}
