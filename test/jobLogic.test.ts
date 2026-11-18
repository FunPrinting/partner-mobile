import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../src/lib/jobLogic.ts';
import { base64, base64url, safeEqual } from '../src/lib/encoding.ts';

const pdf: logic.JobFile = { url: 'https://c.example/raw/upload/abc', name: 'notes', mime: 'application/pdf', copies: 1 };
const docx: logic.JobFile = { url: 'https://c.example/a.docx', name: 'a.docx' };
const ipp: logic.PrintMethod = { kind: 'ipp', formats: ['application/pdf', 'image/jpeg'], sides: ['one-sided'], colorModes: ['monochrome', 'color'], media: ['iso_a4_210x297mm'] };
const job = (over: Partial<logic.Job>): logic.Job => ({ jobId: 'J1', orderId: 'O1', status: 'queued', files: [pdf], createdAt: '2026-11-18T10:00:00Z', ...over });

test('fileKind uses mime, then name, then URL', () => {
  assert.equal(logic.fileKind(pdf), 'pdf');
  assert.equal(logic.fileKind({ url: 'x', name: 'scan.JPG' }), 'jpeg');
  assert.equal(logic.fileKind({ url: 'https://h/p/photo.png?x=1', name: 'Photo' }), 'png');
  assert.equal(logic.fileKind({ url: 'x', name: 'y', mime: 'pdf' }), 'pdf');
  assert.equal(logic.fileKind(docx), 'other');
});

test('cannotPrint explains what the phone or printer lacks', () => {
  assert.equal(logic.cannotPrint(pdf, { kind: 'airprint' }), null);
  assert.match(logic.cannotPrint(docx, { kind: 'dialog' })!, /desktop app/);
  assert.match(logic.cannotPrint({ ...pdf, sided: 'double' }, ipp)!, /double-sided/);
  assert.match(logic.cannotPrint({ ...pdf, pageSize: 'A3' }, ipp)!, /A3/);
  assert.match(logic.cannotPrint({ ...pdf, name: 'p.png', mime: undefined }, ipp)!, /photos/);
  assert.equal(logic.cannotPrint({ ...pdf, sided: 'double' }, { ...ipp, sides: [] }), null, 'unknown caps allowed');
});

test('nextJob picks the oldest printable waiting job and skips given-up ones', () => {
  const jobs = [
    job({ jobId: 'J3', createdAt: '2026-11-18T12:00:00Z' }),
    job({ jobId: 'J2', createdAt: '2026-11-18T11:00:00Z', files: [docx] }),
    job({ jobId: 'J1', createdAt: '2026-11-18T10:00:00Z' }),
    job({ jobId: 'J0', status: 'pending_acceptance', createdAt: '2026-11-18T09:00:00Z' }),
    job({ jobId: 'JF', status: 'failed', claimedBy: 'dev_other', createdAt: '2026-11-18T08:00:00Z' }),
  ];
  assert.equal(logic.nextJob(jobs, ipp, new Set())?.jobId, 'J1');
  assert.equal(logic.nextJob(jobs, ipp, new Set(['J1']))?.jobId, 'J3');
  assert.equal(logic.nextJob(jobs, ipp, new Set(['J1', 'J3'])), null);
});

test('groupJobs splits by status and device', () => {
  const g = logic.groupJobs(
    [job({ jobId: 'a', status: 'pending_acceptance' }), job({ jobId: 'b', status: 'printing', claimedBy: 'me' }), job({ jobId: 'c' }), job({ jobId: 'd', status: 'claimed', claimedBy: 'pc' })],
    'me'
  );
  assert.deepEqual([g.pending, g.mine, g.waiting, g.elsewhere].map((x) => x.map((j) => j.jobId)), [['a'], ['b'], ['c'], ['d']]);
});

test('helpers: versions, summaries, minutes left', () => {
  assert.equal(logic.isNewerVersion('v1.0.21', '1.0.19'), true);
  assert.equal(logic.isNewerVersion('v1.0.19', '1.0.19'), false);
  assert.equal(logic.isNewerVersion('v1.0.9', '1.0.10'), false);
  assert.equal(logic.fileSummary({ ...pdf, color: 'color', sided: 'double', copies: 2 }), 'A4 · Colour · Double-sided · 2 copies');
  assert.equal(logic.minutesLeft('2026-11-18T10:10:00Z', Date.parse('2026-11-18T10:00:30Z')), 10);
});

test('order steps depend on pickup, shop delivery or courier (same as the server)', () => {
  const shop = (status: string) => ({ status, amount: 90, deliveryOption: { type: 'delivery', method: 'shop', deliveryCharge: 40 } });
  const courier = (status: string) => ({ status, amount: 76, deliveryOption: { type: 'delivery', method: 'courier', deliveryCharge: 26 } });
  assert.deepEqual(logic.nextStatuses({ status: 'paid' }), ['printing', 'printed']);
  assert.deepEqual(logic.nextStatuses({ status: 'printed' }), ['ready_for_pickup']);
  assert.deepEqual(logic.nextStatuses({ status: 'ready_for_pickup' }), ['completed']);
  assert.deepEqual(logic.nextStatuses(shop('printed')), ['dispatched']);
  assert.deepEqual(logic.nextStatuses(shop('dispatched')), ['delivered']);
  assert.deepEqual(logic.nextStatuses(courier('printed')), []);
  assert.equal(logic.canBookCourier(courier('printed')), true);
  assert.equal(logic.canBookCourier({ ...courier('printed'), shiprocket: { awbCode: 'X' } }), false);
  assert.equal(logic.partnerShare(shop('printed')), 85);
  assert.equal(logic.partnerShare(courier('printed')), 45);
  assert.equal(logic.fulfilmentOf({ status: 'printed', deliveryOption: { type: 'delivery' } }), 'courier');
});

test('encoding matches Node base64 and compares safely', () => {
  const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 37) & 255);
  for (const n of [0, 1, 2, 3, 49, 50]) {
    assert.equal(base64(bytes.subarray(0, n)), Buffer.from(bytes.subarray(0, n)).toString('base64'));
  }
  assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
});
