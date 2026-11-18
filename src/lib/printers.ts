/**
 * Printing on the phone.
 *
 * - ipp (Android): sends the file straight to a Wi-Fi printer over IPP, with
 *   copies / sides / colour / paper size, and waits for the printer to report
 *   the job completed. No dialog.
 * - airprint (iOS): prints to the AirPrint printer chosen once in Settings,
 *   without a dialog. iOS does not let apps set colour or double-sided here; the
 *   printer's defaults apply.
 * - dialog: the system print dialog for each file; the shop confirms it printed.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as ipp from './ipp';
import { base64 } from './encoding';
import { fileKind, KIND_MIME, type JobFile } from './jobLogic';
import type { PrinterSetting } from './settings';

const IPP_TIMEOUT_MS = 30_000;
const JOB_WAIT_MS = 10 * 60_000;

async function ippCall(httpUrl: string, body: Uint8Array<ArrayBuffer>, timeoutMs = IPP_TIMEOUT_MS) {
  let res;
  try {
    res = await expoFetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp', Accept: 'application/ipp' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('Printer not reachable. Check it is on and on the same Wi-Fi as this phone.');
  }
  if (!res.ok) throw new Error(`Printer answered HTTP ${res.status}`);
  return ipp.decodeResponse(await res.bytes());
}

/** Reads the printer's name, state and capabilities (prints nothing). */
export async function checkIppPrinter(address: string) {
  const urls = ipp.printerUrls(address);
  const res = await ippCall(urls.http, ipp.printerAttributesRequest(urls.ipp), 8000);
  if (!ipp.isSuccess(res.statusCode)) throw new Error(`Printer refused: ${ipp.statusText(res.statusCode)}`);
  return { summary: ipp.printerSummary(res), caps: ipp.capsFrom(res) };
}

/** iOS: pick an AirPrint printer once; later jobs print to it without a dialog. */
export async function chooseAirPrintPrinter() {
  const printer = await Print.selectPrinterAsync();
  return { name: printer.name, url: printer.url };
}

const downloads = new Directory(Paths.cache, 'print-jobs');

export async function downloadJobFile(file: JobFile, key: string): Promise<File> {
  if (!/^https:\/\//i.test(file.url)) throw new Error('File link is not secure');
  if (!downloads.exists) downloads.create({ intermediates: true });
  const target = new File(downloads, `${key.replace(/[^A-Za-z0-9_-]/g, '_')}.${fileKind(file) === 'other' ? 'bin' : fileKind(file)}`);
  return File.downloadFileAsync(file.url, target, { idempotent: true });
}

export function clearDownloads() {
  try {
    if (downloads.exists) downloads.delete();
  } catch {
    // nothing to clear
  }
}

function imageHtml(dataUri: string) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:0}html,body{margin:0;height:100%}img{width:100%;height:100%;object-fit:contain}</style></head><body><img src="${dataUri}"></body></html>`;
}

async function waitForIppJob(urls: { ipp: string; http: string }, jobId: number, onStatus: (s: string) => void) {
  const deadline = Date.now() + JOB_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let res;
    try {
      res = await ippCall(urls.http, ipp.jobAttributesRequest(urls.ipp, jobId), 10_000);
    } catch {
      continue; // printer busy or Wi-Fi hiccup; keep waiting
    }
    if (!ipp.isSuccess(res.statusCode)) return; // printer doesn't track jobs: treat as sent
    const state = Number(res.groups.job?.['job-state']?.[0] ?? 0);
    if (state === ipp.JobState.completed) return;
    if (state === ipp.JobState.canceled || state === ipp.JobState.aborted) {
      const reasons = (res.groups.job?.['job-state-reasons'] ?? []).join(', ');
      throw new Error(`Printer ${state === ipp.JobState.canceled ? 'cancelled' : 'stopped'} the job${reasons ? ` (${reasons})` : ''}`);
    }
    if (state === ipp.JobState.stopped || state === ipp.JobState.held) onStatus('Printer needs attention (paper, ink or a jam?)');
    else onStatus('Printing…');
  }
  // Very long jobs: the printer has it; don't print it again
}

/**
 * Prints one downloaded file. Resolves when printed (ipp/airprint) or when the
 * dialog was used (dialog: the caller asks the shop to confirm).
 */
export async function printFile(printer: PrinterSetting, file: File, opts: JobFile, jobName: string, onStatus: (s: string) => void) {
  const kind = fileKind(opts);
  if (kind === 'other') throw new Error('This file type needs the desktop app');

  if (printer.kind === 'ipp') {
    const urls = ipp.printerUrls(printer.address);
    const caps = { formats: printer.formats, sides: printer.sides, colorModes: printer.colorModes, media: printer.media };
    onStatus('Sending to printer…');
    const res = await ippCall(
      urls.http,
      ipp.printJobRequest({ printerUri: urls.ipp, jobName, format: KIND_MIME[kind], jobAttrs: ipp.jobAttributes(opts, caps), data: await file.bytes() }),
      120_000
    );
    if (!ipp.isSuccess(res.statusCode)) throw new Error(`Printer refused the job: ${ipp.statusText(res.statusCode)}`);
    const printerJobId = Number(res.groups.job?.['job-id']?.[0] ?? 0);
    if (printerJobId) await waitForIppJob(urls, printerJobId, onStatus);
    return;
  }

  const copies = Math.max(1, Math.min(20, opts.copies || 1));
  const printerUrl = printer.kind === 'airprint' ? printer.url : undefined;
  const source = kind === 'pdf' ? { uri: file.uri } : { html: imageHtml(`data:${KIND_MIME[kind]};base64,${base64(await file.bytes())}`) };
  // AirPrint and the dialog take one copy at a time
  for (let i = 0; i < (printerUrl ? copies : 1); i++) {
    onStatus(copies > 1 && printerUrl ? `Printing copy ${i + 1} of ${copies}…` : 'Printing…');
    await Print.printAsync({ ...source, printerUrl });
  }
}
