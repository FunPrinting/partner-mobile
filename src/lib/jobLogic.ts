/**
 * Decisions about print jobs with no React Native imports (tested with node --test).
 * Job shape: FunPrinting-Web src/lib/jobs/http.ts publicJob().
 */

import { whyImpossible, type RouterPrinter } from './router.ts';

export type JobFile = {
  url: string;
  /** The PDF this phone prints (the server converts Word files and photos). */
  printUrl?: string;
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
  customerInfo?: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  deliveryOption?: {
    type?: 'pickup' | 'delivery';
    partnerDeliveryPoint?: string;
    recipientName?: string;
    recipientPhone?: string;
    phone?: string;
    address?: string;
    flatBuilding?: string;
    city?: string;
    pinCode?: string;
    scheduledSlot?: {
      date: string;
      slotId: string;
      label: string;
      startTime: string;
      endTime: string;
      target: 'store' | 'pickup_point';
    };
  };
  amount?: number;
  paymentMethod?: 'online' | 'cod' | string;
  paymentStatus?: string;
  expectedDate?: string;
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

/**
 * Why this phone can't print the file, or null. Files it can't print stay in the shop's
 * queue for a computer. Printers are the phone's own (switched on or off in Settings).
 */
export function cannotPrint(file: JobFile, printers: RouterPrinter[]): string | null {
  if (!file.printUrl) return 'The file is still being prepared';
  const why = whyImpossible(file, printers);
  return why;
}

export function cannotPrintJob(job: Job, printers: RouterPrinter[]): string | null {
  if (!job.files?.length) return 'This job has no files';
  for (const f of job.files) {
    const reason = cannotPrint(f, printers);
    if (reason) return reason;
  }
  return null;
}

/** The oldest waiting job this phone can print, skipping ones it already gave up on. */
export function nextJob(jobs: Job[], printers: RouterPrinter[], skip: ReadonlySet<string>): Job | null {
  const waiting = jobs
    .filter((j) => (j.status === 'queued' || (j.status === 'failed' && !j.claimedBy)) && !skip.has(j.jobId))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  return waiting.find((j) => !cannotPrintJob(j, printers)) ?? null;
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

/** How an order reaches the customer (server: src/lib/partnerOrderTransitions.ts). */
export type Fulfilment = 'pickup' | 'shop' | 'courier';

export interface OrderLike {
  status?: string;
  paymentMethod?: 'online' | 'cod' | string;
  paymentStatus?: string;
  amount?: number;
  deliveryOption?: { type?: string; method?: string; deliveryCharge?: number; distance?: number };
  shiprocket?: { awbCode?: string; courierName?: string };
}

const RANK: Record<string, number> = { paid: 0, processing: 1, printing: 2, printed: 3, ready_for_pickup: 4, dispatched: 5, delivered: 6, completed: 7 };

export function fulfilmentOf(order: OrderLike): Fulfilment {
  if (order.deliveryOption?.type !== 'delivery') return 'pickup';
  return order.deliveryOption.method === 'shop' ? 'shop' : 'courier';
}

/** The next step to offer: printing/printed first, then one step for this kind of order. */
export function nextStatuses(order: OrderLike): string[] {
  const rank = RANK[order.status ?? ''] ?? -1;
  if (rank < 0) return [];
  if (rank < RANK.printed) return ['printing', 'printed'].filter((s) => RANK[s] > rank);
  const steps: Record<Fulfilment, string[]> = { pickup: ['ready_for_pickup', 'completed'], shop: ['dispatched', 'delivered'], courier: [] };
  return steps[fulfilmentOf(order)].filter((s) => RANK[s] > rank).slice(0, 1);
}

/** A printed courier order that still needs its pickup booked. */
export function canBookCourier(order: OrderLike): boolean {
  return fulfilmentOf(order) === 'courier' && order.status === 'printed' && !order.shiprocket?.awbCode;
}

/** 90% of printing on online orders (plus self-delivery fee), or 100% cash kept on COD orders. */
export function partnerShare(order: OrderLike): number {
  const amount = Number(order.amount || 0);
  if (order.paymentMethod === 'cod') return Math.round(amount * 100) / 100;
  const delivery = order.deliveryOption?.type === 'delivery' ? Number(order.deliveryOption.deliveryCharge || 0) : 0;
  return Math.round(((amount - delivery) * 0.9 + (fulfilmentOf(order) === 'shop' ? delivery : 0)) * 100) / 100;
}

export function fulfilmentLabel(order: OrderLike): string {
  const how = fulfilmentOf(order);
  if (how === 'shop') return `You deliver${order.deliveryOption?.distance ? ` · ${order.deliveryOption.distance} km` : ''}`;
  if (how === 'courier') return order.shiprocket?.awbCode ? `Courier · ${order.shiprocket.courierName || 'booked'}` : 'Courier';
  return 'Pickup';
}

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  pending_cod_approval: 'Confirm COD in chat',
  paid: 'Paid',
  processing: 'Processing',
  printing: 'Printing',
  printed: 'Printed',
  ready_for_pickup: 'Ready for pickup',
  dispatched: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Collected',
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
