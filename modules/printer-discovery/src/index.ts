import { requireOptionalNativeModule } from 'expo';

/** One Bonjour service of a printer, as found on the network. */
export type FoundService = {
  name: string;
  type: 'ipp' | 'ipps';
  port: number;
  addresses: string[];
  txt: Record<string, string>;
};

type Native = { scan(timeoutMs: number): Promise<FoundService[]> };

const native = requireOptionalNativeModule<Native>('PrinterDiscovery');

/** False in Expo Go and on a build without the module. */
export const isAvailable = native !== null;

/** Looks for IPP printers for `timeoutMs`. Resolves with an empty list when search is not available. */
export async function scan(timeoutMs = 4000): Promise<FoundService[]> {
  if (!native) return [];
  return native.scan(timeoutMs);
}
