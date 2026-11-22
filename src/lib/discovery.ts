/**
 * Turns the Bonjour services the phone found into one entry per printer, and decides
 * whether a printer in the list is the one a saved printer was. No React Native imports
 * (tested with node --test).
 */
export type FoundService = { name: string; type: 'ipp' | 'ipps'; port: number; addresses: string[]; txt: Record<string, string> };

export type FoundPrinter = {
  /** printer-uuid when the printer announces one, else its service name */
  id: string;
  uuid?: string;
  name: string;
  /** "ipp://192.168.1.9:631/ipp/print" (plain IPP; used for talking to the printer) */
  address?: string;
  addresses: string[];
  port: number;
  /** Only IPPS was announced: the phone talks plain IPP on the local network, so it can't use it. */
  secureOnly: boolean;
  announced: { color?: boolean; duplex?: boolean; pdf?: boolean };
};

const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
const tri = (v?: string) => (v === undefined ? undefined : /^t/i.test(v) ? true : /^f/i.test(v) ? false : undefined);
const cleanUuid = (v?: string) => (v ? v.toLowerCase().replace(/^urn:uuid:/, '') : undefined);

function isIpv4(a: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(a);
}

/** One entry per printer: IPP and IPPS announcements of one printer are merged. */
export function mergeFound(services: FoundService[]): FoundPrinter[] {
  const byKey = new Map<string, { ipp?: FoundService; ipps?: FoundService; txt: Record<string, string>; name: string }>();
  for (const s of services) {
    const txt = lower(s.txt ?? {});
    const key = cleanUuid(txt.uuid) ?? `name:${s.name.toLowerCase()}`;
    const cur = byKey.get(key) ?? { txt, name: s.name };
    cur[s.type] = s;
    cur.txt = { ...txt, ...cur.txt };
    byKey.set(key, cur);
  }
  const out: FoundPrinter[] = [];
  for (const [key, g] of byKey) {
    const svc = g.ipp ?? g.ipps!;
    const addresses = [...new Set([...(g.ipp?.addresses ?? []), ...(g.ipps?.addresses ?? [])])].filter((a) => !a.toLowerCase().startsWith('fe80:'));
    addresses.sort((a, b) => Number(!isIpv4(a)) - Number(!isIpv4(b)));
    const rp = (g.txt.rp ?? 'ipp/print').replace(/^\//, '');
    const host = addresses[0];
    const pdl = (g.txt.pdl ?? '').toLowerCase();
    out.push({
      id: key,
      uuid: cleanUuid(g.txt.uuid),
      name: g.txt.ty || g.name,
      address: g.ipp && host ? `ipp://${host.includes(':') ? `[${host}]` : host}:${g.ipp.port}/${rp}` : undefined,
      addresses,
      port: svc.port,
      secureOnly: !g.ipp,
      announced: { color: tri(g.txt.color), duplex: tri(g.txt.duplex), pdf: pdl ? pdl.includes('application/pdf') : undefined },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The new address of a saved printer, if it is on the network now under another IP.
 * Matched by the printer's own id (printer-uuid), falling back to the same name only when
 * exactly one printer has it.
 */
export function relocate(saved: { uuid?: string; name: string }, found: FoundPrinter[]): FoundPrinter | null {
  if (saved.uuid) return found.find((f) => f.uuid === saved.uuid && f.address) ?? null;
  const same = found.filter((f) => f.name.toLowerCase() === saved.name.toLowerCase() && f.address);
  return same.length === 1 ? same[0] : null;
}
