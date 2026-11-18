/**
 * Minimal IPP/1.1 client encoding (RFC 8010 / 8011), enough to print a PDF on a
 * Wi-Fi printer and follow the job: Print-Job, Validate-Job, Get-Job-Attributes,
 * Get-Printer-Attributes. Pure TypeScript with no React Native imports, so it is
 * tested with `node --test`.
 */

export const Op = {
  PrintJob: 0x0002,
  ValidateJob: 0x0004,
  CancelJob: 0x0008,
  GetJobAttributes: 0x0009,
  GetPrinterAttributes: 0x000b,
} as const;

const Group = { operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05 } as const;

const Tag = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  language: 0x48,
  mime: 0x49,
  name: 0x42,
  text: 0x41,
} as const;

export const JobState = { pending: 3, held: 4, processing: 5, stopped: 6, canceled: 7, aborted: 8, completed: 9 } as const;
export const PrinterState = { idle: 3, processing: 4, stopped: 5 } as const;

type Value = string | number | boolean;
type Attr = { tag: number; name: string; values: Value[] };

export type IppResponse = {
  version: string;
  statusCode: number;
  requestId: number;
  /** Attributes by group name, then attribute name. */
  groups: Record<string, Record<string, Value[]>>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;
  bytes(b: Uint8Array) {
    this.chunks.push(b);
    this.size += b.length;
  }
  u8(n: number) {
    this.bytes(Uint8Array.of(n & 0xff));
  }
  u16(n: number) {
    this.bytes(Uint8Array.of((n >> 8) & 0xff, n & 0xff));
  }
  u32(n: number) {
    this.bytes(Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff));
  }
  result(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

function writeAttr(w: Writer, attr: Attr) {
  attr.values.forEach((value, i) => {
    w.u8(attr.tag);
    const name = i === 0 ? encoder.encode(attr.name) : new Uint8Array(0);
    w.u16(name.length);
    w.bytes(name);
    if (attr.tag === Tag.integer || attr.tag === Tag.enum) {
      w.u16(4);
      w.u32(Number(value));
    } else if (attr.tag === Tag.boolean) {
      w.u16(1);
      w.u8(value ? 1 : 0);
    } else {
      const v = encoder.encode(String(value));
      if (v.length > 0x7fff) throw new Error(`IPP value too long for ${attr.name}`);
      w.u16(v.length);
      w.bytes(v);
    }
  });
}

export type IppRequest = {
  operation: number;
  requestId?: number;
  printerUri: string;
  /** Extra operation attributes, e.g. job-id, document-format, job-name. */
  operationAttrs?: Attr[];
  jobAttrs?: Attr[];
  /** Document data (Print-Job only). */
  data?: Uint8Array;
};

export function encodeRequest(req: IppRequest): Uint8Array<ArrayBuffer> {
  const w = new Writer();
  w.u8(1);
  w.u8(1); // IPP/1.1, accepted by IPP Everywhere and older printers
  w.u16(req.operation);
  w.u32(req.requestId ?? 1);
  w.u8(Group.operation);
  writeAttr(w, { tag: Tag.charset, name: 'attributes-charset', values: ['utf-8'] });
  writeAttr(w, { tag: Tag.language, name: 'attributes-natural-language', values: ['en'] });
  writeAttr(w, { tag: Tag.uri, name: 'printer-uri', values: [req.printerUri] });
  writeAttr(w, { tag: Tag.name, name: 'requesting-user-name', values: ['FunPrinting'] });
  for (const a of req.operationAttrs ?? []) writeAttr(w, a);
  if (req.jobAttrs?.length) {
    w.u8(Group.job);
    for (const a of req.jobAttrs) writeAttr(w, a);
  }
  w.u8(Group.end);
  if (req.data) w.bytes(req.data);
  return w.result();
}

const GROUP_NAMES: Record<number, string> = { 1: 'operation', 2: 'job', 4: 'printer', 5: 'unsupported' };

export function decodeResponse(buf: Uint8Array): IppResponse {
  if (buf.length < 9) throw new Error('IPP response too short');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const res: IppResponse = {
    version: `${buf[0]}.${buf[1]}`,
    statusCode: view.getUint16(2),
    requestId: view.getUint32(4),
    groups: {},
  };
  let i = 8;
  let group: Record<string, Value[]> | null = null;
  let lastName = '';
  while (i < buf.length) {
    const tag = buf[i++];
    if (tag === Group.end) break;
    if (tag <= 0x0f) {
      const name = GROUP_NAMES[tag] ?? `group-${tag}`;
      // Several groups of one kind (e.g. one per job) merge; fine for our needs
      group = res.groups[name] ?? (res.groups[name] = {});
      continue;
    }
    if (i + 2 > buf.length) break;
    const nameLen = view.getUint16(i);
    i += 2;
    const name = decoder.decode(buf.subarray(i, i + nameLen));
    i += nameLen;
    const valueLen = view.getUint16(i);
    i += 2;
    const raw = buf.subarray(i, i + valueLen);
    i += valueLen;
    if (!group) continue;
    let value: Value;
    if ((tag === Tag.integer || tag === Tag.enum) && valueLen === 4) value = view.getInt32(i - 4);
    else if (tag === Tag.boolean && valueLen === 1) value = raw[0] === 1;
    else if (tag >= 0x40 && tag <= 0x4a) value = decoder.decode(raw);
    else value = `<${tag.toString(16)}>`; // dates, ranges, collections: not used
    if (nameLen > 0) {
      lastName = name;
      group[name] = [value];
    } else if (lastName && group[lastName]) {
      group[lastName].push(value);
    }
  }
  return res;
}

export function isSuccess(statusCode: number) {
  return statusCode >= 0x0000 && statusCode <= 0x00ff;
}

const STATUS_TEXT: Record<number, string> = {
  0x0400: 'bad request',
  0x0401: 'forbidden',
  0x0402: 'not authenticated',
  0x0403: 'not authorized',
  0x0404: 'not possible',
  0x040a: 'document format not supported',
  0x040b: 'attributes or values not supported',
  0x0500: 'printer internal error',
  0x0501: 'operation not supported',
  0x0503: 'IPP version not supported',
  0x0507: 'printer is busy',
  0x0509: 'printer is not accepting jobs',
};

export function statusText(code: number) {
  return STATUS_TEXT[code] ?? `IPP status 0x${code.toString(16).padStart(4, '0')}`;
}

// ── Print options ───────────────────────────────────────────────────────

export type PrintOptions = {
  copies?: number;
  sided?: 'single' | 'double';
  color?: 'bw' | 'color' | 'mixed';
  pageSize?: 'A4' | 'A3';
};

export type PrinterCaps = {
  formats: string[];
  sides: string[];
  colorModes: string[];
  media: string[];
};

const MEDIA: Record<string, string> = { A4: 'iso_a4_210x297mm', A3: 'iso_a3_297x420mm' };

/**
 * Job attributes for the file's options, limited to what the printer says it
 * supports, so it doesn't refuse the job over an option it lacks.
 * Mixed colour prints the whole file in colour (an IPP job has one colour mode).
 */
export function jobAttributes(opts: PrintOptions, caps: PrinterCaps): Attr[] {
  const attrs: Attr[] = [];
  const copies = Math.max(1, Math.min(99, Math.floor(opts.copies || 1)));
  if (copies > 1) attrs.push({ tag: Tag.integer, name: 'copies', values: [copies] });
  const sides = opts.sided === 'double' ? 'two-sided-long-edge' : 'one-sided';
  if (caps.sides.includes(sides)) attrs.push({ tag: Tag.keyword, name: 'sides', values: [sides] });
  const color = opts.color === 'color' || opts.color === 'mixed' ? 'color' : 'monochrome';
  if (caps.colorModes.includes(color)) attrs.push({ tag: Tag.keyword, name: 'print-color-mode', values: [color] });
  const media = MEDIA[opts.pageSize || 'A4'];
  if (media && caps.media.includes(media)) attrs.push({ tag: Tag.keyword, name: 'media', values: [media] });
  return attrs;
}

/**
 * What the file needs that the printer can't do. Such jobs are left for another
 * device instead of being printed wrong. Empty capability lists mean "unknown"
 * (the printer didn't say) and are not held against it.
 */
export function unsupportedNeeds(opts: PrintOptions, caps: PrinterCaps): string[] {
  const out: string[] = [];
  if (opts.sided === 'double' && caps.sides.length && !caps.sides.some((s) => s.startsWith('two-sided'))) out.push('double-sided printing');
  if ((opts.color === 'color' || opts.color === 'mixed') && caps.colorModes.length && !caps.colorModes.includes('color')) out.push('colour printing');
  const media = MEDIA[opts.pageSize || 'A4'];
  if (media && caps.media.length && !caps.media.includes(media)) out.push(`${opts.pageSize || 'A4'} paper`);
  return out;
}

export function capsFrom(res: IppResponse): PrinterCaps {
  const p = res.groups.printer ?? {};
  const strings = (name: string) => (p[name] ?? []).filter((v): v is string => typeof v === 'string');
  return {
    formats: strings('document-format-supported'),
    sides: strings('sides-supported'),
    colorModes: strings('print-color-mode-supported'),
    media: strings('media-supported'),
  };
}

export function printerSummary(res: IppResponse) {
  const p = res.groups.printer ?? {};
  const state = Number(p['printer-state']?.[0] ?? 0);
  const reasons = (p['printer-state-reasons'] ?? []).map(String).filter((r) => r !== 'none');
  return {
    name: String(p['printer-make-and-model']?.[0] ?? p['printer-name']?.[0] ?? 'Printer'),
    state: state === PrinterState.idle ? 'idle' : state === PrinterState.processing ? 'printing' : state === PrinterState.stopped ? 'stopped' : 'unknown',
    reasons,
    accepting: p['printer-is-accepting-jobs']?.[0] !== false,
  };
}

// ── Request builders ────────────────────────────────────────────────────

export function printerAttributesRequest(printerUri: string) {
  return encodeRequest({
    operation: Op.GetPrinterAttributes,
    printerUri,
    operationAttrs: [
      {
        tag: Tag.keyword,
        name: 'requested-attributes',
        values: [
          'printer-name',
          'printer-make-and-model',
          'printer-state',
          'printer-state-reasons',
          'printer-is-accepting-jobs',
          'document-format-supported',
          'sides-supported',
          'print-color-mode-supported',
          'media-supported',
        ],
      },
    ],
  });
}

export function printJobRequest(opts: {
  printerUri: string;
  jobName: string;
  format: string;
  jobAttrs: Attr[];
  data?: Uint8Array;
  validateOnly?: boolean;
}) {
  return encodeRequest({
    operation: opts.validateOnly ? Op.ValidateJob : Op.PrintJob,
    printerUri: opts.printerUri,
    operationAttrs: [
      ...(opts.validateOnly ? [] : [{ tag: Tag.name, name: 'job-name', values: [opts.jobName.slice(0, 255)] }]),
      { tag: Tag.mime, name: 'document-format', values: [opts.format] },
    ],
    jobAttrs: opts.jobAttrs,
    data: opts.validateOnly ? undefined : opts.data,
  });
}

export function jobAttributesRequest(printerUri: string, jobId: number) {
  return encodeRequest({
    operation: Op.GetJobAttributes,
    printerUri,
    operationAttrs: [
      { tag: Tag.integer, name: 'job-id', values: [jobId] },
      { tag: Tag.keyword, name: 'requested-attributes', values: ['job-state', 'job-state-reasons'] },
    ],
  });
}

/** "192.168.1.20", "printer.local:631/ipp/print" or a full ipp:// URL → the URLs to use. */
export function printerUrls(input: string): { ipp: string; http: string } {
  let s = input.trim();
  if (!s) throw new Error('Enter the printer address');
  s = s.replace(/^(ipps?|https?):\/\//i, '');
  const slash = s.indexOf('/');
  const hostPort = slash === -1 ? s : s.slice(0, slash);
  const path = slash === -1 ? '/ipp/print' : s.slice(slash) || '/ipp/print';
  if (!/^[A-Za-z0-9.\-[\]:]+$/.test(hostPort)) throw new Error('That does not look like a printer address');
  const hasPort = /:\d+$/.test(hostPort) && !/^\[.*\]$/.test(hostPort);
  const withPort = hasPort ? hostPort : `${hostPort}:631`;
  return { ipp: `ipp://${withPort}${path}`, http: `http://${withPort}${path}` };
}
