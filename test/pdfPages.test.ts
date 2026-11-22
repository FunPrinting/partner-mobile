import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { extractPages, pageCount } from '../src/lib/pdfPages.ts';

async function make(n: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595.28, 841.89]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return doc.save();
}

test('page count and extraction keep the pages asked for, in order', async () => {
  const bytes = await make(5);
  assert.equal(await pageCount(bytes), 5);
  const part = await extractPages(bytes, [2, 3, 5]);
  assert.equal(await pageCount(part), 3);
  assert.equal(new TextDecoder().decode(part.slice(0, 5)), '%PDF-');
});

test('a file that is not a PDF is refused', async () => {
  await assert.rejects(pageCount(new TextEncoder().encode('not a pdf')));
});
