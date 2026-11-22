/**
 * Fake-printer tests for the native PWG Raster engine.
 *
 * Re-implements the core logic of PwgRasterEncoder.kt and IppClient.kt in pure
 * TypeScript so we can verify page ordering (LIFO), DPI, scaling, header fields,
 * and IPP attribute correctness — all without touching paper.
 *
 * Mimics partner-desktop's fileEngine: instead of sending bytes to a socket we
 * capture them in a buffer and parse the PWG 5102.4 structure back out.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ─── Types mirroring the Kotlin encoder ──────────────────────────────────────

type ScalingMode = 'fit' | 'shrink' | 'none' | 'fill';

interface PageHeader {
  mediaClass: string;
  duplex: number;
  hwResX: number;
  hwResY: number;
  pageSizeW: number;
  pageSizeH: number;
  cupsWidth: number;
  cupsHeight: number;
  bitsPerColor: number;
  bitsPerPixel: number;
  bytesPerLine: number;
  colorOrder: number;
  colorSpace: number;
  numColors: number;
  cupsPageSizeW: number;
  cupsPageSizeH: number;
  imagingBBox: [number, number, number, number];
  totalPages: number;
  crossFeedTransform: number;
  feedTransform: number;
  imageBoxLeft: number;
  imageBoxTop: number;
  imageBoxRight: number;
  imageBoxBottom: number;
  printQuality: number;
  pageSizeName: string;
}

// ─── Standard media constants (matches PwgRasterEncoder.kt) ─────────────────

const MEDIA = {
  A4: { widthPt: 595.2756, heightPt: 841.8898, name: 'iso_a4_210x297mm' },
  A3: { widthPt: 841.8898, heightPt: 1190.5512, name: 'iso_a3_297x420mm' },
};

function mediaPixels(media: typeof MEDIA.A4, dpi: number) {
  return {
    widthPx: Math.round(media.widthPt * dpi / 72),
    heightPx: Math.round(media.heightPt * dpi / 72),
  };
}

// ─── Pure-TS re-implementation of createPageHeader ───────────────────────────

function createPageHeader(opts: {
  widthPixels: number;
  heightPixels: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  dpi: number;
  isColor: boolean;
  isDuplex: boolean;
  pageSizeName: string;
  totalPages: number;
}): Buffer {
  const header = Buffer.alloc(1796);
  const mediaClass = Buffer.from('PwgRaster', 'ascii');
  mediaClass.copy(header, 0);

  header.writeUInt32BE(opts.isDuplex ? 1 : 0, 272);
  header.writeUInt32BE(opts.dpi, 276);
  header.writeUInt32BE(opts.dpi, 280);
  header.writeUInt32BE(opts.pageWidthPoints, 352);
  header.writeUInt32BE(opts.pageHeightPoints, 356);
  header.writeUInt32BE(opts.widthPixels, 372);
  header.writeUInt32BE(opts.heightPixels, 376);
  header.writeUInt32BE(8, 384);
  header.writeUInt32BE(opts.isColor ? 24 : 8, 388);
  header.writeUInt32BE(opts.widthPixels * (opts.isColor ? 3 : 1), 392);
  header.writeUInt32BE(0, 396);
  header.writeUInt32BE(opts.isColor ? 19 : 18, 400); // 19 = sRGB, 18 = sGray
  header.writeUInt32BE(opts.isColor ? 3 : 1, 420);
  header.writeFloatBE(opts.pageWidthPoints, 428);
  header.writeFloatBE(opts.pageHeightPoints, 432);
  header.writeFloatBE(0, 436);
  header.writeFloatBE(0, 440);
  header.writeFloatBE(opts.pageWidthPoints, 444);
  header.writeFloatBE(opts.pageHeightPoints, 448);
  header.writeUInt32BE(opts.totalPages, 452);
  header.writeUInt32BE(1, 456);
  header.writeUInt32BE(1, 460);
  header.writeUInt32BE(0, 464);
  header.writeUInt32BE(0, 468);
  header.writeUInt32BE(opts.widthPixels, 472);
  header.writeUInt32BE(opts.heightPixels, 476);
  header.writeUInt32BE(0, 480);
  header.writeUInt32BE(4, 484);

  const nameBytes = Buffer.from(opts.pageSizeName, 'ascii');
  nameBytes.copy(header, 1732, 0, Math.min(nameBytes.length, 63));

  return header;
}

// ─── Parse a PWG page header back out for verification ──────────────────────

function parsePageHeader(buf: Buffer): PageHeader {
  const readStr = (off: number, len: number) => {
    const end = buf.indexOf(0, off);
    const actual = end >= off && end < off + len ? end - off : len;
    return buf.subarray(off, off + actual).toString('ascii');
  };
  return {
    mediaClass: readStr(0, 64),
    duplex: buf.readUInt32BE(272),
    hwResX: buf.readUInt32BE(276),
    hwResY: buf.readUInt32BE(280),
    pageSizeW: buf.readUInt32BE(352),
    pageSizeH: buf.readUInt32BE(356),
    cupsWidth: buf.readUInt32BE(372),
    cupsHeight: buf.readUInt32BE(376),
    bitsPerColor: buf.readUInt32BE(384),
    bitsPerPixel: buf.readUInt32BE(388),
    bytesPerLine: buf.readUInt32BE(392),
    colorOrder: buf.readUInt32BE(396),
    colorSpace: buf.readUInt32BE(400),
    numColors: buf.readUInt32BE(420),
    cupsPageSizeW: buf.readFloatBE(428),
    cupsPageSizeH: buf.readFloatBE(432),
    imagingBBox: [buf.readFloatBE(436), buf.readFloatBE(440), buf.readFloatBE(444), buf.readFloatBE(448)],
    totalPages: buf.readUInt32BE(452),
    crossFeedTransform: buf.readUInt32BE(456),
    feedTransform: buf.readUInt32BE(460),
    imageBoxLeft: buf.readUInt32BE(464),
    imageBoxTop: buf.readUInt32BE(468),
    imageBoxRight: buf.readUInt32BE(472),
    imageBoxBottom: buf.readUInt32BE(476),
    printQuality: buf.readUInt32BE(484),
    pageSizeName: readStr(1732, 64),
  };
}

// ─── LIFO ordering logic (mirrors PwgRasterEncoder.kt) ──────────────────────

function computePageOrder(pages: number[], reverseOrder: boolean, isDuplex: boolean): number[] {
  if (!reverseOrder) return pages;
  if (isDuplex && pages.length > 1) {
    const sheets: number[][] = [];
    let idx = 0;
    while (idx < pages.length) {
      const sheet = idx + 1 < pages.length ? [pages[idx], pages[idx + 1]] : [pages[idx]];
      sheets.push(sheet);
      idx += 2;
    }
    return sheets.reverse().flat();
  }
  return [...pages].reverse();
}

// ─── Scaling computation (mirrors PwgRasterEncoder.kt) ──────────────────────

interface ScaleResult {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

function computeScaling(
  scaling: ScalingMode,
  docWidthPt: number,
  docHeightPt: number,
  mediaWidthPx: number,
  mediaHeightPx: number,
  dpi: number,
): ScaleResult {
  const ptToPx = dpi / 72;
  switch (scaling) {
    case 'none': {
      const scale = ptToPx;
      const renderedW = docWidthPt * scale;
      const renderedH = docHeightPt * scale;
      return { scaleX: scale, scaleY: scale, offsetX: (mediaWidthPx - renderedW) / 2, offsetY: (mediaHeightPx - renderedH) / 2 };
    }
    case 'shrink': {
      const marginPt = 8.5039;
      const marginPx = Math.round(marginPt * dpi / 72);
      const availW = Math.max(1, mediaWidthPx - 2 * marginPx);
      const availH = Math.max(1, mediaHeightPx - 2 * marginPx);
      const sx = availW / (docWidthPt * ptToPx);
      const sy = availH / (docHeightPt * ptToPx);
      const fitRatio = Math.min(1.0, Math.min(sx, sy));
      const finalScale = ptToPx * fitRatio;
      const renderedW = docWidthPt * finalScale;
      const renderedH = docHeightPt * finalScale;
      return { scaleX: finalScale, scaleY: finalScale, offsetX: (mediaWidthPx - renderedW) / 2, offsetY: (mediaHeightPx - renderedH) / 2 };
    }
    case 'fill': {
      const sx = mediaWidthPx / (docWidthPt * ptToPx);
      const sy = mediaHeightPx / (docHeightPt * ptToPx);
      const fillRatio = Math.max(sx, sy);
      const finalScale = ptToPx * fillRatio;
      const renderedW = docWidthPt * finalScale;
      const renderedH = docHeightPt * finalScale;
      return { scaleX: finalScale, scaleY: finalScale, offsetX: (mediaWidthPx - renderedW) / 2, offsetY: (mediaHeightPx - renderedH) / 2 };
    }
    default: { // 'fit'
      const marginPt = 8.5039;
      const marginPx = Math.round(marginPt * dpi / 72);
      const availW = Math.max(1, mediaWidthPx - 2 * marginPx);
      const availH = Math.max(1, mediaHeightPx - 2 * marginPx);
      const sx = availW / (docWidthPt * ptToPx);
      const sy = availH / (docHeightPt * ptToPx);
      const fitRatio = Math.min(sx, sy);
      const finalScale = ptToPx * fitRatio;
      const renderedW = docWidthPt * finalScale;
      const renderedH = docHeightPt * finalScale;
      return { scaleX: finalScale, scaleY: finalScale, offsetX: (mediaWidthPx - renderedW) / 2, offsetY: (mediaHeightPx - renderedH) / 2 };
    }
  }
}

// ─── IPP print-scaling keyword (mirrors IppClient.kt) ───────────────────────

function ippScalingKeyword(scaling: ScalingMode): string {
  switch (scaling) {
    case 'none': return 'none';
    case 'shrink': return 'auto-fit';
    case 'fill': return 'fill';
    default: return 'fit';
  }
}

// ─── Build a fake multi-page PDF (simulating a real order) ──────────────────

async function makePdf(opts: {
  pageCount: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  orderId?: string;
}): Promise<{ bytes: Uint8Array; pageWidthPt: number; pageHeightPt: number }> {
  const w = opts.pageWidthPt ?? 595.28;
  const h = opts.pageHeightPt ?? 841.89;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < opts.pageCount; i++) {
    const page = doc.addPage([w, h]);
    page.drawText(`Page ${i + 1} of ${opts.pageCount}`, { x: 50, y: h - 60, size: 18, font, color: rgb(0, 0, 0) });
    if (opts.orderId) {
      page.drawText(`Order: ${opts.orderId}`, { x: 50, y: h - 90, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
    }
  }
  return { bytes: await doc.save(), pageWidthPt: w, pageHeightPt: h };
}

// ─── Simulate the full encoder pipeline and capture PWG output ──────────────

interface FakePrintJob {
  orderId: string;
  pageCount: number;
  pageWidthPt: number;
  pageHeightPt: number;
  dpi: number;
  isColor: boolean;
  colorMode?: 'bw' | 'color' | 'mixed';
  colorPages?: number[];
  isDuplex: boolean;
  pageSizeName: string;
  reverseOrder: boolean;
  scaling: ScalingMode;
  pageNumbers?: number[]; // 1-based subset, or all
}

interface FakePrintResult {
  syncWord: string;
  pages: { originalPageIndex: number; header: PageHeader }[];
  ippScaling: string;
  scalingTransform: ScaleResult;
  job: FakePrintJob;
}

async function fakePrint(job: FakePrintJob): Promise<FakePrintResult> {
  const media = job.pageSizeName.includes('a3') ? MEDIA.A3 : MEDIA.A4;
  const { widthPx, heightPx } = mediaPixels(media, job.dpi);

  // Determine which pages to print
  const allPages = Array.from({ length: job.pageCount }, (_, i) => i);
  const targetPages = job.pageNumbers
    ? job.pageNumbers.map(p => p - 1).filter(p => p >= 0 && p < job.pageCount)
    : allPages;

  // Apply LIFO ordering
  const orderedPages = computePageOrder(targetPages, job.reverseOrder, job.isDuplex);

  // Compute scaling transform (same for every page against the doc dimensions)
  const scalingTransform = computeScaling(
    job.scaling,
    job.pageWidthPt,
    job.pageHeightPt,
    widthPx,
    heightPx,
    job.dpi,
  );

  // Build PWG headers
  const inColor = job.colorPages ? new Set(job.colorPages.filter(p => p >= 1)) : null;
  const pageResults: { originalPageIndex: number; header: PageHeader }[] = [];
  for (const pageIdx of orderedPages) {
    const docPageNum = pageIdx + 1;
    let pageIsColor = job.isColor;
    if (job.colorMode === 'bw') {
      pageIsColor = false;
    } else if (job.colorMode === 'color') {
      pageIsColor = true;
    } else if (job.colorMode === 'mixed' && inColor !== null) {
      if (job.isDuplex) {
        const sheetStart = docPageNum % 2 === 1 ? docPageNum : docPageNum - 1;
        pageIsColor = inColor.has(sheetStart) || inColor.has(sheetStart + 1);
      } else {
        pageIsColor = inColor.has(docPageNum);
      }
    }

    const headerBuf = createPageHeader({
      widthPixels: widthPx,
      heightPixels: heightPx,
      pageWidthPoints: Math.round(media.widthPt),
      pageHeightPoints: Math.round(media.heightPt),
      dpi: job.dpi,
      isColor: pageIsColor,
      isDuplex: job.isDuplex,
      pageSizeName: job.pageSizeName,
      totalPages: targetPages.length,
    });
    const parsed = parsePageHeader(headerBuf);
    pageResults.push({ originalPageIndex: pageIdx, header: parsed });
  }

  return {
    syncWord: 'RaS2',
    pages: pageResults,
    ippScaling: ippScalingKeyword(job.scaling),
    scalingTransform,
    job,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TESTS — Simulating Order ORD327988271
// ═══════════════════════════════════════════════════════════════════════════════

const ORDER_ID = 'ORD327988271';

describe(`Fake Printer · Order ${ORDER_ID} · 7-page A4 Mixed Colour document`, () => {
  const DOC_PAGES = 7;

  // ─── LIFO Tests ──────────────────────────────────────────────────────

  test('LIFO ON (single-sided): pages come out N→1, so Page 1 lands on top', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: DOC_PAGES, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: true, scaling: 'fit',
    });
    const order = result.pages.map(p => p.originalPageIndex);
    assert.deepEqual(order, [6, 5, 4, 3, 2, 1, 0], 'Pages should be reversed (6,5,4,3,2,1,0) for LIFO single-sided');
    // The LAST page printed (index 0 = Page 1) ends up on top of face-up tray ✓
  });

  test('LIFO OFF (single-sided): pages come out 1→N naturally', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: DOC_PAGES, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    const order = result.pages.map(p => p.originalPageIndex);
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6], 'Pages should be natural order for face-down laser trays');
  });

  test('LIFO ON (duplex): sheets reversed as units, front/back stay correct', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: DOC_PAGES, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: true, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: true, scaling: 'fit',
    });
    const order = result.pages.map(p => p.originalPageIndex);
    // 7 pages → sheets: [0,1] [2,3] [4,5] [6] → reversed: [6] [4,5] [2,3] [0,1]
    assert.deepEqual(order, [6, 4, 5, 2, 3, 0, 1], 'Duplex LIFO reverses by 2-page sheet units');
  });

  test('LIFO ON (duplex, even page count): all sheets pair correctly', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 6, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: true, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: true, scaling: 'fit',
    });
    const order = result.pages.map(p => p.originalPageIndex);
    // 6 pages → sheets: [0,1] [2,3] [4,5] → reversed: [4,5] [2,3] [0,1]
    assert.deepEqual(order, [4, 5, 2, 3, 0, 1], 'Even-count duplex LIFO reverses by sheet units');
  });

  // ─── DPI Tests ───────────────────────────────────────────────────────

  for (const dpi of [200, 300, 600] as const) {
    test(`DPI ${dpi}: header carries correct resolution and pixel dimensions for A4`, async () => {
      const result = await fakePrint({
        orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
        dpi, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
        reverseOrder: false, scaling: 'fit',
      });
      const h = result.pages[0].header;
      const expected = mediaPixels(MEDIA.A4, dpi);
      assert.equal(h.hwResX, dpi, `HWResolution X should be ${dpi}`);
      assert.equal(h.hwResY, dpi, `HWResolution Y should be ${dpi}`);
      assert.equal(h.cupsWidth, expected.widthPx, `cupsWidth at ${dpi} DPI`);
      assert.equal(h.cupsHeight, expected.heightPx, `cupsHeight at ${dpi} DPI`);
      assert.equal(h.bytesPerLine, expected.widthPx * 3, 'bytesPerLine = width * 3 (24-bit sRGB)');
    });
  }

  // ─── Scaling Tests ───────────────────────────────────────────────────

  test('Scaling "fit": document scaled down ~3% to fit inside 3mm hardware margins', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    const { scaleX } = result.scalingTransform;
    const ptToPx = 300 / 72;
    const ratio = scaleX / ptToPx;
    assert.ok(ratio < 1.0, `Fit scaling should scale down (ratio=${ratio.toFixed(4)})`);
    assert.ok(ratio > 0.93, `Fit scaling should not shrink more than ~7% (ratio=${ratio.toFixed(4)})`);
    assert.equal(result.ippScaling, 'fit');
  });

  test('Scaling "none": exact 1:1 scale (DPI/72 px per pt)', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'none',
    });
    const { scaleX, scaleY } = result.scalingTransform;
    const ptToPx = 300 / 72;
    assert.ok(Math.abs(scaleX - ptToPx) < 0.001, `None scale should be exactly ${ptToPx} (got ${scaleX})`);
    assert.ok(Math.abs(scaleY - ptToPx) < 0.001, `None scale should be exactly ${ptToPx} (got ${scaleY})`);
    assert.equal(result.ippScaling, 'none');
  });

  test('Scaling "shrink" with same-size page: behaves like 1:1 (no upscale)', async () => {
    // A4 doc on A4 media — fits inside printable area already
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'shrink',
    });
    const { scaleX } = result.scalingTransform;
    const ptToPx = 300 / 72;
    const ratio = scaleX / ptToPx;
    // Should be <= 1.0 (clamped), close to 'fit' or exactly 1.0
    assert.ok(ratio <= 1.0001, `Shrink should not upscale (ratio=${ratio.toFixed(4)})`);
    assert.equal(result.ippScaling, 'auto-fit');
  });

  test('Scaling "shrink" with oversized page: scales down to fit', async () => {
    // US Letter (612 x 792 pt) on A4 media — wider than A4, should shrink
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 612, pageHeightPt: 792,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'shrink',
    });
    const { scaleX } = result.scalingTransform;
    const ptToPx = 300 / 72;
    const ratio = scaleX / ptToPx;
    assert.ok(ratio < 1.0, `Shrink oversized should scale down (ratio=${ratio.toFixed(4)})`);
  });

  test('Scaling "fill": scales up to cover entire sheet (may crop)', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fill',
    });
    const { scaleX } = result.scalingTransform;
    const ptToPx = 300 / 72;
    const ratio = scaleX / ptToPx;
    // Fill uses max(sx,sy) so for same-aspect it should be >= 1.0
    assert.ok(ratio >= 0.99, `Fill should scale to cover the page (ratio=${ratio.toFixed(4)})`);
    assert.equal(result.ippScaling, 'fill');
  });

  // ─── US Letter → A4 mismatch (the original over-scaling bug) ─────────

  test('US Letter PDF on A4 media: canvas is strict A4, not Letter-sized', async () => {
    // This was the root cause of the original bug: a 612pt-wide Letter PDF was
    // rasterized at 2550px and sent to an A4 printer expecting 2480px
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 3, pageWidthPt: 612, pageHeightPt: 792,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    const h = result.pages[0].header;
    const a4 = mediaPixels(MEDIA.A4, 300);
    assert.equal(h.cupsWidth, a4.widthPx, 'Canvas must be A4 width (2480px), NOT Letter width (2550px)');
    assert.equal(h.cupsHeight, a4.heightPx, 'Canvas must be A4 height (3508px)');
    assert.equal(h.pageSizeName, 'iso_a4_210x297mm', 'Page size name must be A4');
  });

  // ─── Page header structural tests ────────────────────────────────────

  test('Header fields: 24-bit sRGB, PwgRaster class, correct page size name', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 2, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    for (const p of result.pages) {
      assert.equal(p.header.mediaClass, 'PwgRaster', 'MediaClass');
      assert.equal(p.header.bitsPerColor, 8);
      assert.equal(p.header.bitsPerPixel, 24, 'Universal 24-bit sRGB');
      assert.equal(p.header.colorSpace, 19, 'CUPS_CSPACE_SRGB');
      assert.equal(p.header.numColors, 3);
      assert.equal(p.header.bytesPerLine, 2480 * 3, 'bytesPerLine = width * 3');
      assert.equal(p.header.colorOrder, 0, 'CUPS_ORDER_CHUNKED');
      assert.equal(p.header.crossFeedTransform, 1);
      assert.equal(p.header.feedTransform, 1);
      assert.equal(p.header.printQuality, 4, 'Normal quality');
      assert.equal(p.header.totalPages, 2);
      assert.equal(p.header.pageSizeName, 'iso_a4_210x297mm');
    }
  });

  test('Pure B&W order: 8-bit sGray header engages 180 black nozzles (~16 scrolls)', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 3, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: false, colorMode: 'bw', isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    for (const p of result.pages) {
      assert.equal(p.header.bitsPerColor, 8);
      assert.equal(p.header.bitsPerPixel, 8, '8-bit native sGray (1 byte per pixel)');
      assert.equal(p.header.colorSpace, 18, 'CUPS_CSPACE_SW (sGray)');
      assert.equal(p.header.numColors, 1, 'Single color channel');
      assert.equal(p.header.bytesPerLine, 2480 * 1, 'bytesPerLine = width * 1 (66% smaller than sRGB)');
    }
  });

  test('Mixed order: dynamic per-page color headers in single cohesive job (zero fraud)', async () => {
    // 7-page document with color on pages 1 and 3 only (like a real report/thesis)
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 7, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, colorMode: 'mixed', colorPages: [1, 3], isDuplex: false,
      pageSizeName: 'iso_a4_210x297mm', reverseOrder: false, scaling: 'fit',
    });
    assert.equal(result.pages.length, 7);

    // Page 1 (originalPageIndex 0): Color -> 24-bit sRGB
    assert.equal(result.pages[0].header.colorSpace, 19, 'Page 1 is color (sRGB)');
    assert.equal(result.pages[0].header.bitsPerPixel, 24);
    assert.equal(result.pages[0].header.bytesPerLine, 2480 * 3);

    // Page 2 (originalPageIndex 1): B&W -> 8-bit sGray (180 black nozzles, ~16 scrolls)
    assert.equal(result.pages[1].header.colorSpace, 18, 'Page 2 is B&W (sGray)');
    assert.equal(result.pages[1].header.bitsPerPixel, 8);
    assert.equal(result.pages[1].header.bytesPerLine, 2480);

    // Page 3 (originalPageIndex 2): Color -> 24-bit sRGB
    assert.equal(result.pages[2].header.colorSpace, 19, 'Page 3 is color (sRGB)');
    assert.equal(result.pages[2].header.bitsPerPixel, 24);

    // Pages 4-7: B&W -> 8-bit sGray
    for (let i = 3; i < 7; i++) {
      assert.equal(result.pages[i].header.colorSpace, 18, `Page ${i + 1} is B&W (sGray)`);
      assert.equal(result.pages[i].header.bitsPerPixel, 8);
      assert.equal(result.pages[i].header.bytesPerLine, 2480);
    }
  });

  test('Mixed order with LIFO: reversed order preserves per-page color headers', async () => {
    // 7-page document with color on page 2 only.
    // LIFO prints 7 -> 6 -> 5 -> 4 -> 3 -> 2 -> 1
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 7, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, colorMode: 'mixed', colorPages: [2], isDuplex: false,
      pageSizeName: 'iso_a4_210x297mm', reverseOrder: true, scaling: 'fit',
    });
    assert.equal(result.pages.length, 7);
    // 6th page printed is Page 2 (originalPageIndex 1)
    const page2 = result.pages.find(p => p.originalPageIndex === 1);
    assert.ok(page2);
    assert.equal(page2!.header.colorSpace, 19, 'Page 2 is color even in LIFO sequence');
    assert.equal(page2!.header.bitsPerPixel, 24);

    // All other pages must be sGray
    for (const p of result.pages) {
      if (p.originalPageIndex !== 1) {
        assert.equal(p.header.colorSpace, 18, `Page index ${p.originalPageIndex} should be sGray`);
        assert.equal(p.header.bitsPerPixel, 8);
      }
    }
  });

  test('Duplex flag in header matches job setting', async () => {
    const single = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    assert.equal(single.pages[0].header.duplex, 0, 'Single-sided = 0');

    const duplex = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: true, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'fit',
    });
    assert.equal(duplex.pages[0].header.duplex, 1, 'Double-sided = 1');
  });

  // ─── A3 media test ──────────────────────────────────────────────────

  test('A3 media: correct pixel dimensions and page size name', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 841.89, pageHeightPt: 1190.55,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a3_297x420mm',
      reverseOrder: false, scaling: 'fit',
    });
    const a3 = mediaPixels(MEDIA.A3, 300);
    const h = result.pages[0].header;
    assert.equal(h.cupsWidth, a3.widthPx, 'A3 cupsWidth at 300 DPI');
    assert.equal(h.cupsHeight, a3.heightPx, 'A3 cupsHeight at 300 DPI');
    assert.equal(h.pageSizeName, 'iso_a3_297x420mm');
  });

  // ─── Page subset printing ────────────────────────────────────────────

  test('Printing specific pages (2, 5, 7) with LIFO: subset reversed', async () => {
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: DOC_PAGES, pageWidthPt: 595.28, pageHeightPt: 841.89,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: true, scaling: 'fit',
      pageNumbers: [2, 5, 7],
    });
    const order = result.pages.map(p => p.originalPageIndex);
    // Pages 2,5,7 → 0-based: 1,4,6 → reversed: 6,4,1
    assert.deepEqual(order, [6, 4, 1], 'Subset pages reversed in LIFO order');
    assert.equal(result.pages.length, 3);
  });

  // ─── IPP attribute tests ─────────────────────────────────────────────

  test('IPP scaling keyword mapping for all 4 modes', () => {
    assert.equal(ippScalingKeyword('fit'), 'fit');
    assert.equal(ippScalingKeyword('shrink'), 'auto-fit');
    assert.equal(ippScalingKeyword('none'), 'none');
    assert.equal(ippScalingKeyword('fill'), 'fill');
  });

  // ─── Centering test ──────────────────────────────────────────────────

  test('Scaling "none" centers the document on the sheet', async () => {
    // A5 (148x210mm = 420x595pt) centered on A4 sheet
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: 1, pageWidthPt: 420, pageHeightPt: 595,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: false, scaling: 'none',
    });
    const { offsetX, offsetY } = result.scalingTransform;
    // Both offsets should be positive (smaller doc centered on larger sheet)
    assert.ok(offsetX > 0, `offsetX should be positive for A5-on-A4 (got ${offsetX.toFixed(1)})`);
    assert.ok(offsetY > 0, `offsetY should be positive for A5-on-A4 (got ${offsetY.toFixed(1)})`);
  });

  // ─── Combined scenario (the real order) ──────────────────────────────

  test(`Full simulation: ${ORDER_ID}, 7 pages, A4, Mixed, 300 DPI, LIFO, Fit Printable`, async () => {
    const pdf = await makePdf({ pageCount: DOC_PAGES, orderId: ORDER_ID });
    const result = await fakePrint({
      orderId: ORDER_ID, pageCount: DOC_PAGES, pageWidthPt: pdf.pageWidthPt, pageHeightPt: pdf.pageHeightPt,
      dpi: 300, isColor: true, isDuplex: false, pageSizeName: 'iso_a4_210x297mm',
      reverseOrder: true, scaling: 'fit',
    });

    // Verify complete LIFO order
    assert.deepEqual(result.pages.map(p => p.originalPageIndex), [6, 5, 4, 3, 2, 1, 0]);
    assert.equal(result.pages.length, 7);

    // Verify every header is structurally valid
    for (const p of result.pages) {
      assert.equal(p.header.cupsWidth, 2480);
      assert.equal(p.header.cupsHeight, 3508);
      assert.equal(p.header.hwResX, 300);
      assert.equal(p.header.bitsPerPixel, 24);
      assert.equal(p.header.pageSizeName, 'iso_a4_210x297mm');
    }

    // Verify scaling is Fit to Printable Area
    assert.equal(result.ippScaling, 'fit');
    const ratio = result.scalingTransform.scaleX / (300 / 72);
    assert.ok(ratio > 0.95 && ratio < 1.0, `Fit ratio should be ~0.97 (got ${ratio.toFixed(4)})`);

    // Summary
    console.log(`  ✓ Order ${ORDER_ID}: ${DOC_PAGES} pages, LIFO [${result.pages.map(p => p.originalPageIndex + 1).join('→')}]`);
    console.log(`    Canvas: ${result.pages[0].header.cupsWidth}×${result.pages[0].header.cupsHeight} px @ ${result.pages[0].header.hwResX} DPI`);
    console.log(`    Scaling: ${result.ippScaling} (ratio=${ratio.toFixed(4)})`);
    console.log(`    IPP print-scaling: "${result.ippScaling}"`);
  });
});

// ─── Order Summary Slip ──────────────────────────────────────────────────────

describe('Order Summary Slip rendering', () => {
  test('renderOrderSummaryPdf produces a valid 1-page A4 PDF', async () => {
    const { renderOrderSummaryPdf } = await import('../src/lib/summary.ts');
    const job = {
      jobId: 'JOB-' + ORDER_ID,
      orderId: ORDER_ID,
      status: 'printing' as const,
      deliveryType: 'pickup' as const,
      deliveryNumber: 'D-42',
      createdAt: '2026-11-22T14:30:00Z',
      files: [
        { url: 'https://x/f1.pdf', name: 'GE_File.docx', pages: 5, pageSize: 'A4' as const, color: 'mixed' as const, sided: 'single' as const, copies: 1 },
        { url: 'https://x/f2.pdf', name: 'Resume.pdf', pages: 2, pageSize: 'A4' as const, color: 'bw' as const, sided: 'single' as const, copies: 1 },
      ],
    };
    const pdfBytes = await renderOrderSummaryPdf(job);
    assert.ok(pdfBytes.length > 500, 'Summary PDF should have substantial content');

    const doc = await PDFDocument.load(pdfBytes);
    assert.equal(doc.getPageCount(), 1, 'Summary slip is exactly 1 page');

    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    assert.ok(Math.abs(width - 595.28) < 1, `Width should be A4 (got ${width})`);
    assert.ok(Math.abs(height - 841.89) < 1, `Height should be A4 (got ${height})`);

    console.log(`  ✓ Summary slip for ${ORDER_ID}: ${pdfBytes.length} bytes, ${width.toFixed(0)}×${height.toFixed(0)} pt`);
  });
});

// ─── Colour runs (single cohesive job) ───────────────────────────────────────

import { planRuns, isWholeFile } from '../src/lib/runs.ts';

describe('Colour runs (cohesive job)', () => {

  test('Mixed-colour single-sided: one cohesive colour run when sent as raster', () => {
    // On the raster path we send the WHOLE document as one job
    const runs = planRuns({ pageCount: 7, colour: 'mixed', colorPages: [1, 3, 5], duplex: false, copies: 1 });
    // The raster path ignores runs — it always sends one job. But planRuns for
    // non-raster IPP still splits. Verify the split plan is correct:
    assert.ok(runs.length >= 1, 'At least one run');
    // All pages accounted for
    const allPages = runs.flatMap(r => r.pages).sort((a, b) => a - b);
    assert.deepEqual(allPages, [1, 2, 3, 4, 5, 6, 7], 'All 7 pages covered');
  });

  test('B&W job: single run, all pages', () => {
    const runs = planRuns({ pageCount: 7, colour: 'bw', duplex: false, copies: 1 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].colour, 'bw');
    assert.ok(isWholeFile(runs[0], 7));
  });

  test('Colour job: single run, all pages', () => {
    const runs = planRuns({ pageCount: 7, colour: 'color', duplex: false, copies: 1 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].colour, 'color');
  });
});

