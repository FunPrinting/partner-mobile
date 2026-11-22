import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePrinter, whyImpossible, type RouterPrinter } from '../src/lib/router.ts';
import { planRuns, isWholeFile } from '../src/lib/runs.ts';
import { migrateSettings, routerPrinter, upsertPrinter, setPreferredBw, setEnabled, type IppPrinter, type PrinterEntry } from '../src/lib/printerModel.ts';
import * as logic from '../src/lib/jobLogic.ts';

const colour: RouterPrinter = { id: 'c', name: 'Colour', enabled: true, caps: { color: true, duplex: false, a3: false, pdf: true } };
const mono: RouterPrinter = { id: 'm', name: 'Mono', enabled: true, caps: { color: false, duplex: true, a3: true, pdf: true } };

test('colour files go to the colour printer, double-sided to the duplex one', () => {
  assert.equal((choosePrinter({ color: 'color' }, [colour, mono]) as any).printer.id, 'c');
  assert.equal((choosePrinter({ sided: 'double' }, [colour, mono]) as any).printer.id, 'm');
  assert.equal((choosePrinter({ pageSize: 'A3' }, [colour, mono]) as any).printer.id, 'm');
});

test('black and white prefers the mono printer, or the one the shop marked', () => {
  assert.equal((choosePrinter({ color: 'bw' }, [colour, mono]) as any).printer.id, 'm');
  assert.equal((choosePrinter({ color: 'bw' }, [{ ...colour, preferredBw: true }, mono]) as any).printer.id, 'c');
});

test('impossible, wait and exclude', () => {
  assert.match((choosePrinter({ color: 'color', sided: 'double' }, [colour, mono]) as any).reason, /No single printer/);
  assert.match((choosePrinter({ color: 'bw' }, []) as any).reason, /switched on/);
  assert.equal('wait' in choosePrinter({ color: 'bw' }, [colour], { exclude: ['c'] }), true);
  assert.equal('wait' in choosePrinter({ color: 'bw' }, [{ ...colour, online: false }]), true);
  assert.equal(whyImpossible({ color: 'color' }, [mono]), 'None of your printers can do colour.');
});

test('a printer that cannot take PDF never qualifies', () => {
  const noPdf = { ...colour, caps: { ...colour.caps, pdf: false } };
  assert.match(whyImpossible({ color: 'bw' }, [noPdf])!, /PDF/);
});

test('unknown abilities are not held against a printer', () => {
  assert.equal(whyImpossible({ color: 'color', sided: 'double', pageSize: 'A3' }, [{ id: 'x', name: 'x', enabled: true }]), null);
});

test('plan runs: one run, mixed single-sided, mixed double-sided, copies', () => {
  assert.deepEqual(planRuns({ pageCount: 3, colour: 'bw', duplex: false, copies: 2 }), [{ pages: [1, 2, 3], colour: 'bw', copies: 2 }]);
  assert.deepEqual(planRuns({ pageCount: 4, colour: 'mixed', colorPages: [2, 3], duplex: false, copies: 1 }), [
    { pages: [1], colour: 'bw', copies: 1 },
    { pages: [2, 3], colour: 'color', copies: 1 },
    { pages: [4], colour: 'bw', copies: 1 },
  ]);
  // double-sided: a colour page on either side makes the whole sheet colour
  assert.deepEqual(planRuns({ pageCount: 4, colour: 'mixed', colorPages: [2], duplex: true, copies: 1 }), [
    { pages: [1, 2], colour: 'color', copies: 1 },
    { pages: [3, 4], colour: 'bw', copies: 1 },
  ]);
  // several runs and 2 copies: the whole sequence repeats (collated)
  assert.equal(planRuns({ pageCount: 3, colour: 'mixed', colorPages: [2], duplex: false, copies: 2 }).length, 6);
  assert.equal(isWholeFile({ pages: [1, 2, 3], colour: 'bw', copies: 1 }, 3), true);
  assert.equal(isWholeFile({ pages: [2, 3], colour: 'bw', copies: 1 }, 3), false);
});

const ipp: IppPrinter = { kind: 'ipp', id: 'u1', uuid: 'u1', name: 'Epson', address: 'ipp://10.0.0.2:631/ipp/print', enabled: true, preferredBw: false, formats: ['application/pdf'], sides: ['one-sided'], colorModes: ['color', 'monochrome'], media: ['iso_a4_210x297mm'] };

test('router view of a phone printer: caps come from what the printer said', () => {
  assert.deepEqual(routerPrinter(ipp).caps, { pdf: true, color: true, duplex: false, a3: false });
  assert.deepEqual(routerPrinter({ ...ipp, formats: [], sides: [], colorModes: [], media: [] }).caps, { pdf: undefined, color: undefined, duplex: undefined, a3: undefined });
});

test('earlier settings with one printer become a list', () => {
  const m = migrateSettings({ mode: 'station', printer: { kind: 'ipp', address: '10.0.0.5', name: 'Old', formats: [], sides: [], colorModes: [], media: [] } });
  assert.equal(m.mode, 'station');
  assert.equal(m.printers.length, 1);
  assert.equal(m.printers[0].enabled, true);
  assert.equal(m.printers[0].id, '10.0.0.5');
  assert.deepEqual(migrateSettings({ mode: 'companion', printer: null }).printers, []);
  assert.deepEqual(migrateSettings(undefined), { mode: 'companion', printers: [] });
  assert.equal(migrateSettings({ printer: { kind: 'dialog' } }).printers[0].name, 'System print dialog');
});

test('adding a printer again refreshes it but keeps the shop\'s choices', () => {
  const list: PrinterEntry[] = [{ ...ipp, enabled: false, preferredBw: true }];
  const next = upsertPrinter(list, { ...ipp, address: 'ipp://10.0.0.99:631/ipp/print', enabled: true, preferredBw: false });
  assert.equal(next.length, 1);
  assert.equal((next[0] as IppPrinter).address, 'ipp://10.0.0.99:631/ipp/print');
  assert.equal(next[0].enabled, false);
  assert.equal(next[0].preferredBw, true);
  // same printer found under a new id: matched by uuid
  assert.equal(upsertPrinter(list, { ...ipp, id: 'other-id' }).length, 1);
});

test('only one printer is preferred for B&W, and switching off clears it', () => {
  const a: PrinterEntry = { ...ipp, id: 'a' };
  const b: PrinterEntry = { ...ipp, id: 'b', uuid: 'b' };
  let list = setPreferredBw([a, b], 'a', true);
  list = setPreferredBw(list, 'b', true);
  assert.deepEqual(list.map((p) => p.preferredBw), [false, true]);
  assert.equal(setEnabled(list, 'b', false)[1].preferredBw, false);
});

const job = (printUrl?: string, over: Partial<logic.JobFile> = {}) => ({ jobId: 'J1', orderId: 'O1', status: 'queued' as const, files: [{ url: 'https://x/a.docx', printUrl, name: 'a', ...over }], createdAt: '2026-11-18T10:00:00Z' });

test('a job whose files are not converted yet waits, and needs a capable printer', () => {
  assert.match(logic.cannotPrintJob(job(undefined), [colour])!, /still being prepared/);
  assert.equal(logic.cannotPrintJob(job('https://x/a.pdf'), [colour]), null);
  assert.match(logic.cannotPrintJob(job('https://x/a.pdf', { sided: 'double' }), [colour])!, /double-sided/);
  assert.equal(logic.nextJob([job('https://x/a.pdf')], [colour], new Set())?.jobId, 'J1');
  assert.equal(logic.nextJob([job('https://x/a.pdf')], [colour], new Set(['J1'])), null);
});
