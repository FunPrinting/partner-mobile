/**
 * Printing on the phone.
 *
 * - ipp (Android): sends the file straight to a Wi-Fi printer over IPP, with copies / sides /
 *   colour / paper size, and waits for the printer to report the job completed. No dialog.
 *   A file with colour and black-and-white pages is split into same-colour parts, printed
 *   one after the other (like the desktop app).
 * - airprint (iOS): prints to the AirPrint printer chosen once in Settings, without a dialog.
 *   iOS does not let apps set colour or double-sided here; the printer's defaults apply.
 * - dialog: the system print dialog for each file; the shop confirms it printed.
 *
 * Every file is the server's print-ready PDF (`printUrl`): Word files and photos are
 * converted when they are uploaded.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as ipp from './ipp';
import type { JobFile } from './jobLogic';
import type { PrinterEntry } from './printerModel';
import { isWholeFile, planRuns } from './runs';

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
  return { summary: ipp.printerSummary(res), caps: ipp.capsFrom(res), uuid: ipp.printerUuid(res), urls };
}

/** iOS: pick an AirPrint printer once; later jobs print to it without a dialog. */
export async function chooseAirPrintPrinter() {
  const printer = await Print.selectPrinterAsync();
  return { name: printer.name, url: printer.url };
}

const downloads = new Directory(Paths.cache, 'print-jobs');

export async function downloadJobFile(file: JobFile, key: string): Promise<File> {
  const url = file.printUrl;
  if (!url) throw new Error('The file is still being prepared on the server');
  if (!/^https:\/\//i.test(url)) throw new Error('File link is not secure');
  if (!downloads.exists) downloads.create({ intermediates: true });
  const target = new File(downloads, `${key.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
  return File.downloadFileAsync(url, target, { idempotent: true });
}

export function clearDownloads() {
  try {
    if (downloads.exists) downloads.delete();
  } catch {
    // nothing to clear
  }
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
 * Prints one downloaded PDF. Resolves when printed (ipp/airprint) or when the dialog was
 * used (dialog: the caller asks the shop to confirm).
 */
export async function printFile(printer: PrinterEntry, file: File, opts: JobFile, jobName: string, onStatus: (s: string) => void) {
  if (printer.kind === 'ipp') {
    const urls = ipp.printerUrls(printer.address);
    const caps = { formats: printer.formats, sides: printer.sides, colorModes: printer.colorModes, media: printer.media };
    const { extractPages, pageCount } = await import('./pdfPages'); // loaded when first needed, not at start-up
    const bytes = await file.bytes();
    let pages = Math.max(1, opts.pages || 1);
    try {
      pages = await pageCount(bytes);
    } catch {
      // keep the server's page count; the file is sent whole below
    }
    const runs = planRuns({ pageCount: pages, colour: opts.color ?? 'bw', colorPages: opts.colorPages, duplex: opts.sided === 'double', copies: opts.copies ?? 1 });
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const part = runs.length > 1 ? `part ${i + 1} of ${runs.length} (${run.colour === 'color' ? 'colour' : 'B&W'})` : '';
      onStatus(part ? `Sending ${part}…` : 'Sending to printer…');
      const data = isWholeFile(run, pages) ? bytes : await extractPages(bytes, run.pages);
      const res = await ippCall(
        urls.http,
        ipp.printJobRequest({
          printerUri: urls.ipp,
          jobName: runs.length > 1 ? `${jobName} (${i + 1}/${runs.length})` : jobName,
          format: 'application/pdf',
          jobAttrs: ipp.jobAttributes({ copies: run.copies, sided: opts.sided, color: run.colour, pageSize: opts.pageSize }, caps),
          data: data as Uint8Array<ArrayBuffer>,
        }),
        120_000
      );
      if (!ipp.isSuccess(res.statusCode)) throw new Error(`Printer refused the job: ${ipp.statusText(res.statusCode)}`);
      const printerJobId = Number(res.groups.job?.['job-id']?.[0] ?? 0);
      if (printerJobId) await waitForIppJob(urls, printerJobId, (s) => onStatus(part ? `${s} ${part}` : s));
    }
    return;
  }

  const copies = Math.max(1, Math.min(20, opts.copies || 1));
  const printerUrl = printer.kind === 'airprint' ? printer.url : undefined;
  // AirPrint and the dialog take one copy at a time
  for (let i = 0; i < (printerUrl ? copies : 1); i++) {
    onStatus(copies > 1 && printerUrl ? `Printing copy ${i + 1} of ${copies}…` : 'Printing…');
    await Print.printAsync({ uri: file.uri, printerUrl });
  }
}
