/**
 * Print station: when this phone is in station mode, the app is open and a
 * printer is set, it takes one job at a time from the shop's queue, prints its
 * files and reports printed / failed (FunPrinting-Web docs/PRINT_JOBS.md).
 *
 * - Picks a job by id (claim), only one it can print; others stay for a computer.
 * - Reports "printing" every 2 minutes so it keeps the job.
 * - Stops a job that was cancelled or refunded meanwhile.
 * - Saves the current job and unsent reports, so a restart resumes the job
 *   (skipping printed files) and still sends the report.
 * - After a failure, waits 2 minutes before taking another job.
 */
import { Alert, AppState } from 'react-native';
import { reportError } from './errors';
import { cannotPrintJob, nextJob, type Job } from './jobLogic';
import { jobsStore, syncJobs } from './jobs';
import { refindPrinter } from './findPrinters';
import { clearDownloads, downloadJobFile, printFile } from './printers';
import { api, deviceId, NotSignedInError } from './session';
import { printerLabel, routerPrinter, type PrinterEntry } from './printerModel';
import { choosePrinter } from './router';
import { settingsStore } from './settings';
import { readJson, writeJson } from './storage';
import { createStore } from './store';

const HEARTBEAT_MS = 2 * 60_000;
const COOLDOWN_MS = 2 * 60_000;
const FILE_ATTEMPTS = 3;

type Report = { jobId: string; orderId: string; deliveryType?: string; status: 'printed' | 'failed' | 'release'; error?: string };
type Saved = { current: { job: Job; done: number[] } | null; reports: Report[] };

export type StationState = {
  active: boolean;
  current: { jobId: string; label: string; file: number; files: number; status: string } | null;
  cooldownUntil?: number;
  lastError?: string;
  pendingReports: number;
  skipped: Record<string, string>; // jobId -> reason this phone can't print it
};

export const stationStore = createStore<StationState>({ active: false, current: null, pendingReports: 0, skipped: {} });

let saved: Saved = readJson<Saved>('station', { current: null, reports: [] });
let running = false;
let cooldownUntil = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function persist() {
  writeJson('station', saved);
  stationStore.set({ pendingReports: saved.reports.length });
}

function setStatus(status: string) {
  const cur = stationStore.get().current;
  if (cur) stationStore.set({ current: { ...cur, status } });
}

const switchedOn = () => settingsStore.get().printers.filter((p) => p.enabled);

function enabled() {
  const s = settingsStore.get();
  return s.mode === 'station' && s.printers.some((p) => p.enabled) && AppState.currentState === 'active' && Boolean(deviceId());
}

const jobPath = (id: string) => `/api/partner/v1/jobs/${encodeURIComponent(id)}`;

/** Printers used so far for the current job, shown to the shop as "Printed on <phone> · <printer>". */
let usedPrinters: string[] = [];

function report(jobId: string, status: string, error?: string) {
  const printer = usedPrinters.join(', ') || printerLabel(switchedOn()[0]);
  return api(jobPath(jobId), { method: 'POST', body: { action: 'report', status, ...(error ? { error: error.slice(0, 500) } : {}), ...(printer ? { printer: printer.slice(0, 200) } : {}) } });
}

async function flushReports() {
  while (saved.reports.length) {
    const r = saved.reports[0];
    let res;
    try {
      res = await report(r.jobId, r.status, r.error);
    } catch (err) {
      if (err instanceof NotSignedInError) throw err;
      return; // offline: next round
    }
    if (!res.ok && (res.status >= 500 || res.status === 429 || res.status === 401)) return;
    saved.reports.shift();
    persist();
    if (!res.ok) {
      reportError(new Error(`Job report refused: ${(res.data as any).error || res.status}`), { level: 'warning', context: { ...r } });
    } else if (r.status === 'printed' && r.deliveryType === 'pickup') {
      api(`/api/partner/orders/${encodeURIComponent(r.orderId)}`, { method: 'PATCH', body: { status: 'ready_for_pickup' } }).catch(() => undefined);
    }
  }
}

function startHeartbeat(jobId: string) {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    report(jobId, 'printing').catch(() => undefined);
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

function finish(job: Job, status: Report['status'], error?: string) {
  stopHeartbeat();
  saved.current = null;
  saved.reports.push({ jobId: job.jobId, orderId: job.orderId, deliveryType: job.deliveryType, status, ...(error ? { error } : {}) });
  persist();
  stationStore.set({ current: null });
  clearDownloads();
}

/** Still ours on the server? (cancelled / refunded / taken over → stop) */
function stillMine(jobId: string) {
  const j = jobsStore.get().jobs.find((x) => x.jobId === jobId);
  return Boolean(j && (j.status === 'claimed' || j.status === 'printing') && j.claimedBy === deviceId());
}

function confirm(title: string, message: string, buttons: { text: string; value: string; style?: 'cancel' | 'destructive' }[]) {
  return new Promise<string>((resolve) => {
    Alert.alert(title, message, buttons.map((b) => ({ text: b.text, style: b.style, onPress: () => resolve(b.value) })), { cancelable: false });
  });
}

/** Prints the current job's remaining files. Returns when finished or stopped. */
async function printCurrent() {
  const cur = saved.current!;
  const job = cur.job;
  usedPrinters = [];
  startHeartbeat(job.jobId);
  for (let i = 0; i < job.files.length; i++) {
    if (cur.done.includes(i)) continue;
    const file = job.files[i];
    const label = `#${job.deliveryNumber || job.orderId}`;
    stationStore.set({ current: { jobId: job.jobId, label, file: i + 1, files: job.files.length, status: 'Downloading…' } });
    let lastError = '';
    let printed = false;
    let printer: PrinterEntry = switchedOn()[0];
    const failedOn: string[] = [];
    for (let attempt = 1; attempt <= FILE_ATTEMPTS && !printed; attempt++) {
      try {
        // Each attempt picks a printer that can do this file, leaving out ones that just failed
        let choice = choosePrinter(file, switchedOn().map(routerPrinter), { exclude: failedOn });
        if (!('printer' in choice)) {
          failedOn.length = 0;
          choice = choosePrinter(file, switchedOn().map(routerPrinter));
        }
        if (!('printer' in choice)) throw new Error(choice.reason);
        const picked = switchedOn().find((p) => p.id === choice.printer.id);
        if (!picked) throw new Error('The printer was switched off');
        printer = picked;
        if (!usedPrinters.includes(printer.name)) usedPrinters.push(printer.name);
        const local = await downloadJobFile(file, `${job.jobId}_${i}`);
        await printFile(printer, local, file, `${label} ${file.name}`.slice(0, 100), setStatus);
        if (printer.kind === 'dialog') {
          const answer = await confirm('Did it print correctly?', `${file.name} (${i + 1} of ${job.files.length})`, [
            { text: 'Print again', value: 'again' },
            { text: 'Problem', value: 'problem', style: 'destructive' },
            { text: 'Yes', value: 'yes' },
          ]);
          if (answer === 'again') {
            attempt--;
            continue;
          }
          if (answer === 'problem') {
            lastError = 'The shop reported a problem with the print';
            break;
          }
        }
        printed = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        failedOn.push(printer.id);
        // The printer may have a new IP address (router restart): look for it by its own id and retry
        if (printer.kind === 'ipp' && /not reachable/i.test(lastError)) {
          const moved = await refindPrinter(printer).catch(() => null);
          if (moved) {
            setStatus('Found the printer at a new address');
            failedOn.pop();
            attempt--;
            continue;
          }
        }
        // iOS: closing the dialog without printing
        if (printer.kind === 'dialog' && /cancel/i.test(lastError)) {
          const answer = await confirm('Printing cancelled', 'Give this order back to the queue for another device, or try again?', [
            { text: 'Give back', value: 'release', style: 'destructive' },
            { text: 'Try again', value: 'retry' },
          ]);
          if (answer === 'release') {
            finish(job, 'release');
            return;
          }
          attempt--;
          continue;
        }
        if (attempt < FILE_ATTEMPTS) {
          setStatus(`Retrying: ${lastError}`);
          await new Promise((r) => setTimeout(r, attempt * 10_000));
        }
      }
      if (!stillMine(job.jobId)) {
        await syncJobs();
        if (!stillMine(job.jobId)) {
          stopHeartbeat();
          saved.current = null;
          persist();
          stationStore.set({ current: null });
          return; // cancelled or refunded meanwhile: nothing to report
        }
      }
    }
    if (!printed) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      stationStore.set({ cooldownUntil, lastError });
      reportError(new Error(`Print failed: ${lastError}`), { level: 'warning', context: { jobId: job.jobId, file: file.name, printer: printer.kind } });
      finish(job, 'failed', lastError);
      setTimeout(() => runStation(), COOLDOWN_MS + 1000);
      return;
    }
    cur.done.push(i);
    persist();
  }
  finish(job, 'printed');
}

/** Resume the saved job if the server still has it for this phone. */
async function reconcile(): Promise<boolean> {
  const cur = saved.current;
  if (!cur) return false;
  const sj = jobsStore.get().jobs.find((j) => j.jobId === cur.job.jobId);
  if (sj && (sj.status === 'claimed' || sj.status === 'printing') && sj.claimedBy === deviceId()) return true;
  if (sj && (sj.status === 'queued' || (sj.status === 'failed' && !sj.claimedBy))) {
    const res = await api(jobPath(sj.jobId), { method: 'POST', body: { action: 'claim' } });
    if (res.ok) return true;
  }
  saved.current = null;
  persist();
  return false;
}

async function round(): Promise<boolean> {
  const printers = switchedOn().map(routerPrinter);
  if (!printers.length) return false;
  await flushReports();
  if (saved.current && (await reconcile())) {
    await printCurrent();
    return true;
  }
  if (Date.now() < cooldownUntil) return false;
  const jobs = jobsStore.get().jobs;
  // Remember why jobs are left for a computer, for the jobs list
  const reasons: Record<string, string> = {};
  for (const j of jobs) {
    if (j.status !== 'queued' && j.status !== 'failed') continue;
    const r = cannotPrintJob(j, printers);
    if (r) reasons[j.jobId] = r;
  }
  stationStore.set({ skipped: reasons });
  const candidate = nextJob(jobs, printers, new Set(Object.keys(reasons)));
  if (!candidate) return false;
  const res = await api<{ job?: Job; error?: string }>(jobPath(candidate.jobId), { method: 'POST', body: { action: 'claim' } });
  if (!res.ok || !res.data.job) {
    await syncJobs();
    return true; // someone else took it; look again
  }
  saved.current = { job: res.data.job, done: [] };
  persist();
  report(candidate.jobId, 'printing').catch(() => undefined);
  await syncJobs();
  await printCurrent();
  return true;
}

/** Run until there is nothing this phone can print. Safe to call often. */
export async function runStation() {
  stationStore.set({ active: enabled() });
  if (running || !enabled()) return;
  running = true;
  try {
    for (let i = 0; i < 50 && enabled(); i++) {
      const more = await round();
      if (!more) break;
    }
    stationStore.set({ lastError: Date.now() < cooldownUntil ? stationStore.get().lastError : undefined, cooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : undefined });
  } catch (err) {
    if (!(err instanceof NotSignedInError)) {
      stationStore.set({ lastError: err instanceof Error ? err.message : String(err) });
      reportError(err, { context: { where: 'printStation' } });
    }
  } finally {
    running = false;
  }
}

/** Before sign-out: hand the current job back so another device can print it. */
export async function releaseCurrent() {
  const cur = saved.current;
  stopHeartbeat();
  if (cur) await report(cur.job.jobId, 'release').catch(() => undefined);
  saved = { current: null, reports: [] };
  persist();
  stationStore.set({ current: null, skipped: {} });
}

export function stationHasWork() {
  return Boolean(saved.current) || running;
}
