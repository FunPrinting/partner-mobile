import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Job } from './jobLogic';

const SIZES = { A4: [595.28, 841.89] as [number, number] };
const latin1 = (s: string) => String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/**
 * Renders an A4 Order Summary Slip (cover sheet) to print after the document pages.
 * Because face-up printers stack LIFO, printing this after the document places it
 * on the VERY TOP of the stack in the output tray for staff to identify.
 */
export async function renderOrderSummaryPdf(job: Job): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Order ${job.orderId}`);
  const [W, H] = SIZES.A4;
  const page = doc.addPage([W, H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 48;
  const ink = rgb(0, 0, 0);
  const grey = rgb(0.35, 0.35, 0.35);
  let y = H - M;

  const text = (s: string, { size = 11, font = regular, color = ink, x = M } = {}) => {
    page.drawText(latin1(s), { x, y, size, font, color });
  };

  // Delivery number (large on top for easy staff pickup)
  y -= 40;
  text(job.deliveryNumber || job.orderId, { size: 36, font: bold });
  y -= 22;
  text(`Order #${job.orderId}`, { size: 14, font: bold });
  y -= 18;
  const placed = job.createdAt ? new Date(job.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  text([placed, job.deliveryType === 'delivery' ? 'Delivery' : 'Pickup'].filter(Boolean).join('  |  '), { color: grey });

  y -= 20;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ink });

  y -= 26;
  text(`Files (${job.files.length})`, { size: 12, font: bold });
  y -= 10;
  for (let i = 0; i < job.files.length; i++) {
    const f = job.files[i];
    y -= 16;
    if (y < M + 60) break;
    const desc = `${i + 1}. ${f.name} · ${f.pages ?? '?'} p · ${f.pageSize || 'A4'} · ${f.sided === 'double' ? '2-sided' : '1-sided'} · ${f.color || 'B&W'} · ${f.copies || 1} cop`;
    text(desc.slice(0, 75), { size: 10.5, font: regular });
  }

  y = M + 20;
  text('FunPrinting Partner · Print Station', { size: 9, font: regular, color: grey });

  return doc.save({ useObjectStreams: true });
}
