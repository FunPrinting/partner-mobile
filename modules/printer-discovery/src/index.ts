import { requireOptionalNativeModule } from 'expo';

/** One Bonjour service of a printer, as found on the network. */
export type FoundService = {
  name: string;
  type: 'ipp' | 'ipps';
  port: number;
  addresses: string[];
  txt: Record<string, string>;
};

export type PrinterProbeResult = {
  success: boolean;
  name: string;
  state: 'idle' | 'printing' | 'stopped' | 'unknown';
  accepting: boolean;
  formats: string[];
  colorModes: string[];
  sides: string[];
  media: string[];
  uuid?: string;
  resolvedUrl: string;
  useTls: boolean;
};

export type PrintRasterOptions = {
  copies?: number;
  sided?: 'single' | 'double';
  color?: 'bw' | 'color' | 'mixed';
  pageSize?: 'A4' | 'A3';
  jobName?: string;
  pages?: number[];
  dpi?: number;
};

export type PrintRasterResult = {
  success: boolean;
  jobId: number;
  statusCode?: number;
  message?: string;
};

export type JobStatusResult = {
  state: number;
  stateReasons: string[];
};

type Native = {
  scan(timeoutMs: number): Promise<FoundService[]>;
  probePrinter?(address: string): Promise<PrinterProbeResult>;
  sendIpp?(url: string, requestBase64: string): Promise<{ status: number; responseBase64: string }>;
  printRaster?(printerUrl: string, pdfUri: string, options: Record<string, unknown>): Promise<PrintRasterResult>;
  getJobStatus?(printerUrl: string, jobId: number): Promise<JobStatusResult>;
  startStationService?(title: string, message: string): Promise<boolean>;
  stopStationService?(): Promise<boolean>;
  isStationServiceRunning?(): Promise<boolean>;
  requestNotificationPermission?(): Promise<boolean>;
};

const native = requireOptionalNativeModule<Native>('PrinterDiscovery');

/** False in Expo Go and on a build without the module. */
export const isAvailable = native !== null;

/** Looks for IPP printers for `timeoutMs`. Resolves with an empty list when search is not available. */
export async function scan(timeoutMs = 4000): Promise<FoundService[]> {
  if (!native) return [];
  return native.scan(timeoutMs);
}

/** Probes a printer using native IPP/IPPS client with local network self-signed certificate trust. */
export async function probePrinter(address: string): Promise<PrinterProbeResult | null> {
  if (!native || !native.probePrinter) return null;
  return native.probePrinter(address);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (typeof g.Buffer !== 'undefined') {
    return g.Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function base64ToUint8(base64: string): Uint8Array {
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (typeof g.Buffer !== 'undefined') {
    return new Uint8Array(g.Buffer.from(base64, 'base64'));
  }
  const binary = typeof atob === 'function' ? atob(base64) : '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Sends a raw IPP binary request via native client (supports local TLS self-signed certs and HTTP 426 upgrade).
 */
export async function sendIpp(url: string, requestBytes: Uint8Array): Promise<{ status: number; bytes: Uint8Array } | null> {
  if (!native || !native.sendIpp) return null;
  const base64 = uint8ToBase64(requestBytes);
  const res = await native.sendIpp(url, base64);
  return {
    status: res.status,
    bytes: base64ToUint8(res.responseBase64),
  };
}

/**
 * In-App Direct Host (Option A):
 * Renders PDF on-device, encodes to PWG 5102.4 Raster, and streams directly to printer.
 */
export async function printRaster(printerUrl: string, pdfUri: string, options: PrintRasterOptions): Promise<PrintRasterResult> {
  if (!native || !native.printRaster) {
    throw new Error('Native PWG Raster Engine is only available on Android');
  }
  return native.printRaster(printerUrl, pdfUri, options as Record<string, unknown>);
}

/** Queries current job state and reasons. */
export async function getJobStatus(printerUrl: string, jobId: number): Promise<JobStatusResult | null> {
  if (!native || !native.getJobStatus) return null;
  return native.getJobStatus(printerUrl, jobId);
}

/** Starts or updates the Android Foreground Service for persistent background station printing. */
export async function startStationService(title = 'FunPrinting Partner · Station Active', message = 'Checking orders and printing in background'): Promise<boolean> {
  if (!native || !native.startStationService) return false;
  return native.startStationService(title, message);
}

/** Stops the Android Foreground Service and removes the persistent notification. */
export async function stopStationService(): Promise<boolean> {
  if (!native || !native.stopStationService) return false;
  return native.stopStationService();
}

/** Checks whether the Android Foreground Service is currently running. */
export async function isStationServiceRunning(): Promise<boolean> {
  if (!native || !native.isStationServiceRunning) return false;
  return native.isStationServiceRunning();
}

/** Requests Android 13+ POST_NOTIFICATIONS permission for the foreground service notification. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!native || !native.requestNotificationPermission) return false;
  return native.requestNotificationPermission();
}
