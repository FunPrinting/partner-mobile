/** Page count and page extraction for PDFs (pure JavaScript, no native code). */
import { PDFDocument } from 'pdf-lib';

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

/** A new PDF with only `pages` (1-based, in order) of the source. */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}
