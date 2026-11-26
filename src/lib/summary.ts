import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Job } from './jobLogic';

const SIZES = { A4: [595.28, 841.89] as [number, number] };
const WEB_URL = 'https://www.funprinting.store';

const latin1 = (s: unknown) => String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const colourText: Record<string, string> = { bw: 'Black & White', color: 'Colour', mixed: 'Mixed Colour' };

function fileLine(f: any, i: number) {
  const colour = f.color === 'mixed' && f.colorPages?.length ? `Colour pages ${compactPages(f.colorPages)}` : colourText[f.color] || 'Black & White';
  const sided = f.sided === 'double' ? 'Double-sided' : 'Single-sided';
  const copies = f.copies || 1;
  return `${i + 1}. ${f.name || `File ${i + 1}`}  |  ${f.pages ?? '?'} page(s)  |  ${f.pageSize || 'A4'}  |  ${sided}  |  ${colour}  |  ${copies} cop${copies === 1 ? 'y' : 'ies'}`;
}

function compactPages(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(', ');
}

function wrap(text: string, font: any, size: number, width: number): string[] {
  const words = latin1(text).split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Renders an A4 Order Summary Slip (cover sheet) to print after the document pages.
 * Includes complete order details, files breakdown, customer information,
 * pickup/delivery details, and a verification QR code.
 */
export async function renderOrderSummaryPdf(job: Job, order: any = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Order Summary ${job.orderId}`);
  const [W, H] = SIZES.A4;
  const page = doc.addPage([W, H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 48;
  const ink = rgb(0, 0, 0);
  const blue = rgb(0.1, 0.1, 0.5);
  const grey = rgb(0.35, 0.35, 0.35);
  let y = H - M;

  const text = (s: unknown, { size = 11, font = regular, color = ink, x = M } = {}) => {
    page.drawText(latin1(s), { x, y, size, font, color });
  };

  const drawDivider = () => {
    y -= 12;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ink });
    y -= 18;
  };

  // Merge order and job fields
  const c = order.customerInfo || (job as any).customerInfo || {};
  const d = order.deliveryOption || (job as any).deliveryOption || {};
  const amt = order.amount ?? (job as any).amount ?? order.pricing?.totalPrice;
  const due = order.expectedDate || (job as any).expectedDate;
  const services = ((job as any).service && (job as any).service.length ? (job as any).service : order.printingOptions?.serviceOptions) || [];

  // ============ 1. HEADER WITH QR CODE ============
  const qrSize = 100;
  const qrX = W - M - qrSize;
  const qrY = H - M - qrSize + 10;

  try {
    const qr = QRCode.create(`${WEB_URL}/orders/${encodeURIComponent(job.orderId)}?scan=qr`, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    const cell = qrSize / count;
    for (let r = 0; r < count; r++) {
      for (let col = 0; col < count; col++) {
        if (qr.modules.get(r, col)) {
          page.drawRectangle({
            x: qrX + col * cell,
            y: qrY + (count - 1 - r) * cell,
            width: cell,
            height: cell,
            color: ink,
          });
        }
      }
    }
    const scanLabel = 'Scan to verify order';
    const labelW = regular.widthOfTextAtSize(scanLabel, 8);
    page.drawText(scanLabel, { x: qrX + (qrSize - labelW) / 2, y: qrY - 12, size: 8, font: regular, color: grey });
  } catch (err) {
    console.error('Failed to generate QR code on summary:', err);
  }

  // Left header
  text('Order Summary', { size: 24, font: bold });
  y -= 26;
  text(`Order ID: ${job.orderId}`, { size: 13, font: bold, color: blue });
  y -= 18;
  if (job.deliveryNumber) {
    text(`Delivery Tag: #${job.deliveryNumber}`, { size: 12, font: bold, color: ink });
    y -= 16;
  }
  const placed = job.createdAt ? new Date(job.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  text(`Order Time: ${placed}`, { size: 10, color: grey });
  y -= 26;

  // Payment badge in header so staff can physically separate COD vs Prepaid prints at a glance
  const paymentMethod = String(order.paymentMethod || job.paymentMethod || 'online').toLowerCase();
  const paymentStatus = order.paymentStatus ?? job.paymentStatus;
  const isCod = paymentMethod === 'cod';
  const isCodPending = isCod && paymentStatus !== 'completed';
  const badgeText = isCodPending
    ? `COD - COLLECT CASH${amt !== undefined ? ` (Rs ${amt})` : ''}`
    : isCod
      ? `COD - CASH PAID${amt !== undefined ? ` (Rs ${amt})` : ''}`
      : `PREPAID - ONLINE PAID${amt !== undefined ? ` (Rs ${amt})` : ''}`;
  const badgeW = Math.min(qrX - M - 16, bold.widthOfTextAtSize(badgeText, 11) + 20);
  const badgeH = 22;
  if (isCodPending) {
    page.drawRectangle({ x: M, y: y - 5, width: badgeW, height: badgeH, color: ink });
    page.drawText(latin1(badgeText), { x: M + 10, y: y + 2, size: 11, font: bold, color: rgb(1, 1, 1) });
  } else {
    page.drawRectangle({
      x: M,
      y: y - 5,
      width: badgeW,
      height: badgeH,
      color: isCod ? rgb(0.94, 0.94, 0.94) : rgb(0.94, 0.96, 1),
      borderColor: isCod ? ink : blue,
      borderWidth: 1.5,
    });
    page.drawText(latin1(badgeText), { x: M + 10, y: y + 2, size: 11, font: bold, color: isCod ? ink : blue });
  }
  y -= 8;

  // Move below header and QR
  y = Math.min(y, qrY - 25);
  drawDivider();

  // ============ 2. ORDER DETAILS ============
  text('Order Details', { size: 14, font: bold });
  y -= 20;

  const totalFiles = (job.files || []).length;
  const totalPages = (job.files || []).reduce((acc, f) => acc + (f.pages || 1) * (f.copies || 1), 0);
  const totalCopies = (job.files || []).reduce((acc, f) => acc + (f.copies || 1), 0);

  text(`Files Count: ${totalFiles}  |  Total Pages: ${totalPages}  |  Total Copies: ${totalCopies}`, { size: 11, font: bold });
  y -= 18;

  // File breakdown list
  text('Files Breakdown:', { size: 11, font: bold, color: grey });
  y -= 4;
  for (const [i, f] of (job.files || []).entries()) {
    for (const line of wrap(fileLine(f, i), regular, 10, W - 2 * M)) {
      y -= 15;
      if (y < M + 140) break;
      text(line, { size: 10 });
    }
  }

  // Service Options / Finishing
  y -= 16;
  if (services.length > 0) {
    text(`Service Options: ${services.join(', ')}`, { size: 11, font: bold });
  } else {
    text('Service Options: None', { size: 11, color: grey });
  }
  y -= 16;

  // Payment Method & Total Amount
  const payLine = isCodPending
    ? 'Payment: COD (Cash on Pickup - COLLECT CASH)'
    : isCod
      ? 'Payment: COD (Cash Paid)'
      : 'Payment: PREPAID (Online Paid)';
  if (amt !== undefined) {
    text(`${payLine}  |  Total: Rs ${amt}`, { size: 12, font: bold });
    y -= 16;
  } else {
    text(payLine, { size: 12, font: bold });
    y -= 16;
  }

  // Expected Delivery / Scheduled Pickup Slot
  if (d.scheduledSlot?.date) {
    const slotDateStr = new Date(`${d.scheduledSlot.date}T00:00:00Z`).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
    const slotTime = d.scheduledSlot.label ? String(d.scheduledSlot.label).replace(/\u2013/g, '-') : '';
    text(`Scheduled Pickup: ${slotDateStr}${slotTime ? ` | ${slotTime}` : ''}`, { size: 11, font: bold });
    y -= 16;
  } else if (due) {
    const dueStr = new Date(due).toLocaleDateString('en-IN', { dateStyle: 'medium' });
    text(`Expected Delivery: ${dueStr}`, { size: 11 });
    y -= 16;
  }

  // Fulfilment / Pickup Details
  if (d.partnerDeliveryPoint) {
    text(`Pickup Point: ${d.partnerDeliveryPoint}`, { size: 11, font: bold });
    y -= 16;
  } else if (d.type === 'delivery' || job.deliveryType === 'delivery') {
    const recipient = [d.recipientName, d.recipientPhone].filter(Boolean).join(' · ');
    const address = [d.flatBuilding, d.address, d.city, d.pinCode].filter(Boolean).join(', ');
    text(`Deliver To: ${recipient || 'Customer Address'}`, { size: 11, font: bold });
    y -= 15;
    if (address) {
      text(`Address: ${address}`, { size: 10 });
      y -= 15;
    }
  } else {
    text('Fulfilment: In-Store Pickup (Free)', { size: 11, color: grey });
    y -= 16;
  }

  drawDivider();

  // ============ 3. CUSTOMER INFORMATION ============
  text('Customer Information', { size: 14, font: bold });
  y -= 20;

  text(`Name: ${c.name || 'Not provided'}`, { size: 11, font: c.name ? bold : regular });
  y -= 16;
  text(`Phone: ${c.phone || 'Not provided'}`, { size: 11 });
  y -= 16;
  text(`Email: ${c.email || 'Not provided'}`, { size: 11 });

  // Footer branding
  y = M;
  text('FunPrinting Partner · Print Station', { size: 9, color: grey });

  return doc.save({ useObjectStreams: true });
}
