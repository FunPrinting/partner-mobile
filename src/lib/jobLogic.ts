/**
 * Decisions about print jobs with no React Native imports (tested with node --test).
 * Job shape: FunPrinting-Web src/lib/jobs/http.ts publicJob().
 */

export type JobFile = {
  url: string;
  name: string;
  mime?: string;
  pages?: number;
  pageSize?: 'A4' | 'A3';
  color?: 'color' | 'bw' | 'mixed';
  sided?: 'single' | 'double';
  copies?: number;
  colorPages?: number[];
};

export type Job = {
  jobId: string;
  orderId: string;
  status: 'pending_acceptance' | 'queued' | 'claimed' | 'printing' | 'printed' | 'failed' | 'cancelled';
  deliveryType?: 'pickup' | 'delivery';
  deliveryNumber?: string;
  files: JobFile[];
  acceptBy?: string;
  claimedBy?: string;
  leaseUntil?: string;
  lastError?: string;
  createdAt?: string;
};

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'other';

const EXT_KIND: Record<string, FileKind> = { pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', png: 'png' };
const MIME_KIND: Record<string, FileKind> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png' };
export const KIND_MIME: Record<Exclude<FileKind, 'other'>, string> = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png' };

function ext(s: string) {
  const m = /\.([A-Za-z0-9]{1,5})(?:$|[?#])/.exec(s);
  return m ? m[1].toLowerCase() : '';
}

export function fileKind(file: Pick<JobFile, 'name' | 'mime' | 'url'>): FileKind {
  const mime = String(file.mime || '').toLowerCase();
  if (MIME_KIND[mime]) return MIME_KIND[mime];
  if (mime && !mime.includes('/') && EXT_KIND[mime]) return EXT_KIND[mime]; // older orders store "pdf"
  const fromName = EXT_KIND[ext(file.name || '')];
  if (fromName) return fromName;
  let path = file.url || '';
  try {
    path = new URL(file.url).pathname;
  } catch {
    // keep the raw string
  }
  return EXT_KIND[ext(path)] ?? 'other';
}

export type PrintMethod =
  | { kind: 'ipp'; formats: string[]; sides: string[]; colorModes: string[]; media: string[] }
  | { kind: 'airprint' }
  | { kind: 'dialog' };

/**
 * Why this phone can't print the file, or null. Files it can't print stay in the
 * shop's queue for a computer (Word files, for example, need the desktop app).
 */
export function cannotPrint(file: JobFile, method: PrintMethod): string | null {
  const kind = fileKind(file);
  if (kind === 'other') return 'This file type needs the desktop app';
  if (method.kind !== 'ipp') return null;
  const mime = KIND_MIME[kind];
  if (method.formats.length && !method.formats.includes(mime)) {
    return kind === 'pdf' ? 'This printer does not accept PDF over Wi-Fi' : 'This printer does not accept photos over Wi-Fi';
  }
  if (file.sided === 'double' && method.sides.length && !method.sides.some((s) => s.startsWith('two-sided'))) return 'Needs double-sided printing';
  if ((file.color === 'color' || file.color === 'mixed') && method.colorModes.length && !method.colorModes.includes('color')) return 'Needs colour printing';
  const media = file.pageSize === 'A3' ? 'iso_a3_297x420mm' : 'iso_a4_210x297mm';
  if (method.media.length && !method.media.includes(media)) return `Needs ${file.pageSize || 'A4'} paper`;
  return null;
}

export function cannotPrintJob(job: Job, method: PrintMethod): string | null {
  if (!job.files?.length) return 'This job has no files';
  for (const f of job.files) {
    const reason = cannotPrint(f, method);
    if (reason) return reason;
  }
  return null;
}

/** The oldest waiting job this phone can print, skipping ones it already gave up on. */
export function nextJob(jobs: Job[], method: PrintMethod, skip: ReadonlySet<string>): Job | null {
  const waiting = jobs
    .filter((j) => (j.status === 'queued' || (j.status === 'failed' && !j.claimedBy)) && !skip.has(j.jobId))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  return waiting.find((j) => !cannotPrintJob(j, method)) ?? null;
}

export type JobGroups = { pending: Job[]; mine: Job[]; waiting: Job[]; elsewhere: Job[] };

export function groupJobs(jobs: Job[], myDeviceId?: string): JobGroups {
  const g: JobGroups = { pending: [], mine: [], waiting: [], elsewhere: [] };
  for (const j of jobs) {
    if (j.status === 'pending_acceptance') g.pending.push(j);
    else if ((j.status === 'claimed' || j.status === 'printing') && j.claimedBy === myDeviceId) g.mine.push(j);
    else if (j.status === 'queued' || j.status === 'failed') g.waiting.push(j);
    else if (j.status === 'claimed' || j.status === 'printing') g.elsewhere.push(j);
  }
  return g;
}

// ── Orders ──────────────────────────────────────────────────────────────

/** Forward moves a partner may make (server: src/lib/partnerOrderTransitions.ts). */
export const NEXT_STATUSES: Record<string, string[]> = {
  paid: ['printing', 'printed'],
  processing: ['printing', 'printed'],
  printing: ['printed'],
  printed: ['ready_for_pickup', 'delivered', 'completed'],
  ready_for_pickup: ['delivered', 'completed'],
  dispatched: ['delivered', 'completed'],
  delivered: ['completed'],
};

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Processing',
  printing: 'Printing',
  printed: 'Printed',
  ready_for_pickup: 'Ready for pickup',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function fileSummary(f: JobFile) {
  const color = f.color === 'color' ? 'Colour' : f.color === 'mixed' ? 'Mixed colour' : 'B&W';
  const copies = f.copies || 1;
  return `${f.pageSize || 'A4'} · ${color} · ${f.sided === 'double' ? 'Double-sided' : 'Single-sided'} · ${copies} ${copies === 1 ? 'copy' : 'copies'}`;
}

export function minutesLeft(iso?: string, now = Date.now()) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000));
}

/** "v1.0.21" > "1.0.19" */
export function isNewerVersion(latest: string, current: string) {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
