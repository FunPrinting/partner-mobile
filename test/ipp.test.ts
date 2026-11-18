import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ipp from '../src/lib/ipp.ts';

const caps: ipp.PrinterCaps = {
  formats: ['application/pdf', 'image/jpeg'],
  sides: ['one-sided'],
  colorModes: ['monochrome', 'color'],
  media: ['iso_a4_210x297mm'],
};

test('printerUrls accepts an IP, host:port/path and full URLs', () => {
  assert.deepEqual(ipp.printerUrls('192.168.1.20'), { ipp: 'ipp://192.168.1.20:631/ipp/print', http: 'http://192.168.1.20:631/ipp/print' });
  assert.deepEqual(ipp.printerUrls('ipp://printer.local/ipp/print'), { ipp: 'ipp://printer.local:631/ipp/print', http: 'http://printer.local:631/ipp/print' });
  assert.equal(ipp.printerUrls('10.0.0.5:8631/printers/x').http, 'http://10.0.0.5:8631/printers/x');
  assert.throws(() => ipp.printerUrls(''));
  assert.throws(() => ipp.printerUrls('bad host!'));
});

test('encodeRequest writes header, operation group and end tag', () => {
  const bytes = ipp.printerAttributesRequest('ipp://h:631/ipp/print');
  assert.deepEqual([...bytes.subarray(0, 8)], [1, 1, 0, 0x0b, 0, 0, 0, 1]);
  assert.equal(bytes[8], 0x01);
  assert.equal(bytes[bytes.length - 1], 0x03);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /attributes-charset.*utf-8/s);
  assert.match(text, /document-format-supported/);
});

test('Print-Job carries job attributes and document data after the end tag', () => {
  const data = Uint8Array.of(0x25, 0x50, 0x44, 0x46); // %PDF
  const bytes = ipp.printJobRequest({
    printerUri: 'ipp://h:631/ipp/print',
    jobName: 'Order 1',
    format: 'application/pdf',
    jobAttrs: ipp.jobAttributes({ copies: 3, color: 'bw', pageSize: 'A4', sided: 'single' }, caps),
    data,
  });
  assert.deepEqual([...bytes.subarray(-5)], [0x03, ...data]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /copies/);
  assert.match(text, /print-color-mode.*monochrome/s);
  assert.match(text, /media.*iso_a4/s);
  // Validate-Job sends no data
  const v = ipp.printJobRequest({ printerUri: 'ipp://h/x', jobName: 'x', format: 'application/pdf', jobAttrs: [], data, validateOnly: true });
  assert.equal(v[v.length - 1], 0x03);
  assert.equal(v[3], 0x04);
});

test('decodeResponse reads groups, multi-value attributes, enums and booleans', () => {
  // Build a response with the same writer the requests use
  const enc = (s: string) => [...new TextEncoder().encode(s)];
  const attr = (tag: number, name: string, value: number[]) => [tag, 0, name.length, ...enc(name), 0, value.length, ...value];
  const extra = (tag: number, value: number[]) => [tag, 0, 0, 0, value.length, ...value];
  const bytes = Uint8Array.from([
    1, 1, 0, 0, 0, 0, 0, 7,
    0x01, ...attr(0x47, 'attributes-charset', enc('utf-8')),
    0x04,
    ...attr(0x23, 'printer-state', [0, 0, 0, 3]),
    ...attr(0x22, 'printer-is-accepting-jobs', [1]),
    ...attr(0x44, 'sides-supported', enc('one-sided')),
    ...extra(0x44, enc('two-sided-long-edge')),
    ...attr(0x34, 'media-col-database', []), // collection: ignored values
    ...extra(0x4a, enc('media-size')),
    ...extra(0x37, []),
    ...attr(0x41, 'printer-make-and-model', enc('EPSON L3250')),
    0x03,
  ]);
  const res = ipp.decodeResponse(bytes);
  assert.equal(res.statusCode, 0);
  assert.equal(res.requestId, 7);
  assert.deepEqual(res.groups.printer['sides-supported'], ['one-sided', 'two-sided-long-edge']);
  assert.deepEqual(ipp.printerSummary(res), { name: 'EPSON L3250', state: 'idle', reasons: [], accepting: true });
});

test('jobAttributes only sends options the printer supports', () => {
  const attrs = ipp.jobAttributes({ copies: 1, sided: 'double', color: 'mixed', pageSize: 'A3' }, caps);
  assert.deepEqual(attrs.map((a) => a.name), ['print-color-mode']);
  assert.deepEqual(attrs[0].values, ['color']);
});

test('unsupportedNeeds lists what the printer cannot do; unknown caps are not held against it', () => {
  assert.deepEqual(ipp.unsupportedNeeds({ sided: 'double', pageSize: 'A3' }, caps), ['double-sided printing', 'A3 paper']);
  assert.deepEqual(ipp.unsupportedNeeds({ color: 'color' }, { ...caps, colorModes: ['monochrome'] }), ['colour printing']);
  assert.deepEqual(ipp.unsupportedNeeds({ sided: 'double', color: 'color', pageSize: 'A3' }, { formats: [], sides: [], colorModes: [], media: [] }), []);
});

test('statusText names common errors', () => {
  assert.equal(ipp.statusText(0x040a), 'document format not supported');
  assert.equal(ipp.isSuccess(0x0001), true);
  assert.equal(ipp.isSuccess(0x0400), false);
});
