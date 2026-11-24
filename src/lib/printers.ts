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
import { isAvailable, probePrinter, sendIpp, printRaster, getJobStatus } from '../../modules/printer-discovery';
import * as ipp from './ipp';
import type { Job, JobFile } from './jobLogic';
import type { IppPrinter, PrinterEntry } from './printerModel';
import { isWholeFile, planRuns } from './runs';
import { renderOrderSummaryPdf } from './summary';

const IPP_TIMEOUT_MS = 30_000;
const JOB_WAIT_MS = 10 * 60_000;

async function doFetch(url: string, body: Uint8Array<ArrayBuffer>, timeoutMs: number) {
  if (isAvailable) {
    try {
      const nativeRes = await sendIpp(url, body);
      if (nativeRes) {
        return {
          status: nativeRes.status,
          ok: nativeRes.status >= 200 && nativeRes.status <= 299,
          bytes: async () => nativeRes.bytes,
          arrayBuffer: async () => nativeRes.bytes.buffer,
        };
      }
    } catch {
      // Fall through to expoFetch/fetch
    }
  }
  try {
    return await expoFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp', Accept: 'application/ipp' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (expoErr) {
    if (typeof globalThis.fetch === 'function') {
      try {
        return await globalThis.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/ipp', Accept: 'application/ipp' },
          body: body as any,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Fall back to original error
      }
    }
    throw expoErr;
  }
}

async function ippCall(httpUrl: string, body: Uint8Array<ArrayBuffer>, timeoutMs = IPP_TIMEOUT_MS) {
  let res;
  try {
    res = await doFetch(httpUrl, body, timeoutMs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Printer not reachable (${detail}). If a VPN or Private DNS is active on this phone, please turn it off or enable local network bypass to reach 192.168.x.x.`
    );
  }
  if (res.status === 426) {
    // The printer enforces TLS/encrypted IPPS and raster formatting (e.g. Epson L-series)
    throw new Error('This Wi-Fi printer requires Android print services (Epson Print Enabler or Mopria). Tap "Use the system print dialog" below to print to it over Wi-Fi.');
  }
  if (!res.ok) throw new Error(`Printer answered HTTP ${res.status}`);
  const bytes = typeof res.bytes === 'function' ? await res.bytes() : new Uint8Array(await res.arrayBuffer());
  return ipp.decodeResponse(bytes);
}

/** Reads the printer's name, state and capabilities (prints nothing). */
export async function checkIppPrinter(address: string) {
  // Proactive native probe: handles self-signed TLS certs and automatic 426 HTTP->HTTPS upgrade
  if (isAvailable) {
    try {
      const probed = await probePrinter(address);
      if (probed && probed.success) {
        const summary = {
          name: probed.name,
          state: probed.state,
          reasons: [],
          accepting: probed.accepting,
        };
        const caps = {
          formats: probed.formats,
          sides: probed.sides,
          colorModes: probed.colorModes,
          media: probed.media,
        };
        const urls = ipp.printerUrls(probed.resolvedUrl);
        return { summary, caps, uuid: probed.uuid, urls };
      }
    } catch {
      // Fall through to manual candidate probing
    }
  }

  const urls = ipp.printerUrls(address);

  // Candidate paths to test: requested path first, followed by common printer endpoints
  const cleanHttp = urls.http.replace(/\/(ipp\/print|ipp\/printer|printers\/ipp)?\/?$/, '');
  const cleanIpp = urls.ipp.replace(/\/(ipp\/print|ipp\/printer|printers\/ipp)?\/?$/, '');
  const candidates: { http: string; ipp: string }[] = [
    urls,
    { http: `${cleanHttp}/ipp/print`, ipp: `${cleanIpp}/ipp/print` },
    { http: `${cleanHttp}/ipp/printer`, ipp: `${cleanIpp}/ipp/printer` },
    { http: `${cleanHttp}/printers/ipp`, ipp: `${cleanIpp}/printers/ipp` },
    { http: `${cleanHttp}/`, ipp: `${cleanIpp}/` },
  ];

  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.http)) return false;
    seen.add(c.http);
    return true;
  });

  let lastError: Error | null = null;
  for (const candidate of unique) {
    try {
      const res = await ippCall(candidate.http, ipp.printerAttributesRequest(candidate.ipp), 5000);
      if (ipp.isSuccess(res.statusCode)) {
        return { summary: ipp.printerSummary(res), caps: ipp.capsFrom(res), uuid: ipp.printerUuid(res), urls: candidate };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Printer not reachable. Check it is on and on the same Wi-Fi as this phone.');
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

    // Prefer native status check with TLS / self-signed certificate trust
    if (isAvailable) {
      try {
        const nativeStatus = await getJobStatus(urls.http, jobId);
        if (nativeStatus && nativeStatus.state > 0) {
          if (nativeStatus.state === 9) return; // completed
          if (nativeStatus.state === 7 || nativeStatus.state === 8) {
            const reasons = nativeStatus.stateReasons.join(', ');
            throw new Error(`Printer ${nativeStatus.state === 7 ? 'cancelled' : 'stopped'} the job${reasons ? ` (${reasons})` : ''}`);
          }
          if (nativeStatus.state === 6) onStatus('Printer needs attention (paper, ink or a jam?)');
          else onStatus('Printing…');
          continue;
        }
      } catch (nativeErr) {
        if (nativeErr instanceof Error && /cancelled|stopped/.test(nativeErr.message)) throw nativeErr;
        // Wi-Fi or query hiccup: continue waiting
        continue;
      }
    }

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
    const isRasterPrinter = !caps.formats.includes('application/pdf') && caps.formats.includes('image/pwg-raster');

    if (isRasterPrinter && isAvailable) {
      // Option A: In-App Direct Host (Native PWG Raster Engine)
      // Send the entire file in one cohesive print job so all pages (color, mixed, or B&W)
      // print continuously in order, without splitting into disjoint jobs that cause connection resets
      onStatus('Sending to printer…');
      const rasterRes = await printRaster(urls.http, file.uri, {
        copies: opts.copies || 1,
        sided: opts.sided,
        color: opts.color,
        colorPages: opts.colorPages,
        pageSize: opts.pageSize,
        dpi: (printer as IppPrinter).dpi || 300,
        jobName,
        reverseOrder: (printer as IppPrinter).reverseOrder !== false,
        scaling: (printer as IppPrinter).scaling || 'fit',
      });
      if (rasterRes.jobId) {
        await waitForIppJob(urls, rasterRes.jobId, onStatus);
      }
      return;
    }

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

/**
 * Prints an A4 Order Summary Slip (ticket) after the document.
 * Because face-up trays (like Epson L3250) stack LIFO, printing this last places
 * it right on top of the physical tray for the shop and customer.
 */
export async function printOrderSummary(
  printer: PrinterEntry,
  job: Job,
  orderOrStatus?: any,
  onStatus?: (s: string) => void
) {
  const order = typeof orderOrStatus === 'object' && orderOrStatus !== null ? orderOrStatus : undefined;
  const statusCb = typeof orderOrStatus === 'function' ? orderOrStatus : (onStatus || (() => {}));
  const bytes = await renderOrderSummaryPdf(job, order);
  if (!downloads.exists) downloads.create({ intermediates: true });
  const summaryFile = new File(downloads, `summary_${job.jobId.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
  summaryFile.write(bytes);

  const jobFile: JobFile = {
    name: `Order Summary #${job.deliveryNumber || job.orderId}`,
    url: summaryFile.uri,
    printUrl: summaryFile.uri,
    pages: 1,
    pageSize: 'A4',
    sided: 'single',
    color: 'bw',
    copies: 1,
  };

  if (printer.kind === 'ipp') {
    const urls = ipp.printerUrls(printer.address);
    const caps = { formats: printer.formats, sides: printer.sides, colorModes: printer.colorModes, media: printer.media };
    const isRasterPrinter = !caps.formats.includes('application/pdf') && caps.formats.includes('image/pwg-raster');

    if (isRasterPrinter && isAvailable) {
      statusCb('Printing order summary…');
      const rasterRes = await printRaster(urls.http, summaryFile.uri, {
        copies: 1,
        sided: 'single',
        color: 'bw',
        pageSize: 'A4',
        dpi: (printer as IppPrinter).dpi || 300,
        jobName: `Summary #${job.deliveryNumber || job.orderId}`,
        reverseOrder: false,
        scaling: 'fit',
      });
      if (rasterRes.jobId) {
        await waitForIppJob(urls, rasterRes.jobId, statusCb);
      }
      return;
    }
  }

  await printFile(printer, summaryFile, jobFile, `Summary #${job.deliveryNumber || job.orderId}`, statusCb);
}
