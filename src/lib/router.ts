/**
 * Chooses which of the shop's printers prints a file (same rules as the desktop app,
 * partner-desktop/src/print/router.js). No React Native imports; tested with node --test.
 *
 * A printer qualifies when it is switched on and can do what the file needs: colour,
 * double-sided, A3, and a PDF over Wi-Fi. A file goes to one printer, never split.
 * Among qualifying printers: the one marked "preferred for B&W" takes B&W files, then a
 * printer without colour (keeps colour ink for colour jobs), then by name.
 *
 * Abilities that are unknown (the printer didn't say) are not held against it.
 */
export type RouterCaps = { color?: boolean; duplex?: boolean; a3?: boolean; pdf?: boolean };
export type RouterPrinter = { id: string; name: string; enabled: boolean; preferredBw?: boolean; online?: boolean; caps?: RouterCaps };
export type RouterFile = { color?: 'color' | 'bw' | 'mixed'; sided?: 'single' | 'double'; pageSize?: 'A4' | 'A3' };
export type Choice = { printer: RouterPrinter } | { wait: true; reason: string } | { impossible: true; reason: string };

const needsOf = (f: RouterFile) => ({ colour: f.color === 'color' || f.color === 'mixed', duplex: f.sided === 'double', a3: f.pageSize === 'A3' });

function lacks(needs: ReturnType<typeof needsOf>, p: RouterPrinter): string[] {
  const c = p.caps;
  if (!c) return [];
  const out: string[] = [];
  if (c.pdf === false) out.push('PDF over Wi-Fi');
  if (needs.colour && c.color === false) out.push('colour');
  if (needs.duplex && c.duplex === false) out.push('double-sided printing');
  if (needs.a3 && c.a3 === false) out.push('A3 paper');
  return out;
}

export function choosePrinter(file: RouterFile, printers: RouterPrinter[], opts: { exclude?: string[] } = {}): Choice {
  const needs = needsOf(file);
  const enabled = printers.filter((p) => p.enabled);
  if (!enabled.length) return { impossible: true, reason: 'No printer is switched on. Choose a printer in Settings.' };
  const capable = enabled.filter((p) => lacks(needs, p).length === 0);
  if (!capable.length) {
    const wanted = [needs.colour && 'colour', needs.duplex && 'double-sided printing', needs.a3 && 'A3 paper'].filter(Boolean) as string[];
    const noPdf = enabled.every((p) => p.caps?.pdf === false);
    if (noPdf) return { impossible: true, reason: 'The printer does not accept PDF over Wi-Fi. This order is left for a computer.' };
    const everywhere = wanted.filter((w) => enabled.some((p) => !lacks(needs, p).includes(w)));
    if (wanted.length > 1 && everywhere.length === wanted.length) return { impossible: true, reason: `No single printer can do ${wanted.join(' and ')} together.` };
    const missing = wanted.filter((w) => !everywhere.includes(w));
    return { impossible: true, reason: `None of your printers can do ${(missing.length ? missing : wanted).join(' and ')}.` };
  }
  const exclude = opts.exclude ?? [];
  const ready = capable.filter((p) => p.online !== false && !exclude.includes(p.id));
  if (!ready.length) return { wait: true, reason: 'Your printer is not ready. The job waits until it is.' };
  const bw = !needs.colour;
  const rank = (p: RouterPrinter): (number | string)[] => [bw && p.preferredBw ? 0 : 1, bw && p.caps?.color === false ? 0 : 1, p.name];
  ready.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  return { printer: ready[0] };
}

/** Why no switched-on printer could ever print this file, or null. */
export function whyImpossible(file: RouterFile, printers: RouterPrinter[]): string | null {
  const r = choosePrinter(file, printers.map((p) => ({ ...p, online: true })));
  return 'impossible' in r ? r.reason : null;
}
