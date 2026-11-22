import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFound, relocate, type FoundService } from '../src/lib/discovery.ts';

const txt = { ty: 'EPSON L3250 Series', UUID: 'CFE92100-67C4-11D4-A45F-D4808B1C0BA2', rp: 'ipp/print', Color: 'T', Duplex: 'F', pdl: 'image/pwg-raster,application/vnd.epson.escpr' };
const ipp: FoundService = { name: 'EPSON L3250 Series', type: 'ipp', port: 631, addresses: ['192.168.1.9', 'fe80::1'], txt };
const ipps: FoundService = { ...ipp, type: 'ipps', addresses: ['192.168.1.9'] };

test('IPP and IPPS announcements of one printer become one entry with a plain IPP address', () => {
  const found = mergeFound([ipps, ipp]);
  assert.equal(found.length, 1);
  assert.equal(found[0].uuid, 'cfe92100-67c4-11d4-a45f-d4808b1c0ba2');
  assert.equal(found[0].address, 'ipp://192.168.1.9:631/ipp/print');
  assert.deepEqual(found[0].addresses, ['192.168.1.9']);
  assert.deepEqual(found[0].announced, { color: true, duplex: false, pdf: false });
  assert.equal(found[0].secureOnly, false);
});

test('a printer that only announces IPPS is marked as such and has no plain address', () => {
  const [f] = mergeFound([ipps]);
  assert.equal(f.secureOnly, true);
  assert.equal(f.address, undefined);
});

test('two printers stay apart; names sort', () => {
  const other: FoundService = { name: 'HP', type: 'ipp', port: 631, addresses: ['192.168.1.20'], txt: { ty: 'HP LaserJet', UUID: 'x' } };
  assert.deepEqual(mergeFound([ipp, other]).map((f) => f.name), ['EPSON L3250 Series', 'HP LaserJet']);
});

test('printers without a uuid are joined by service name', () => {
  const a: FoundService = { name: 'Old', type: 'ipp', port: 631, addresses: ['10.0.0.2'], txt: { ty: 'Old' } };
  assert.equal(mergeFound([a, { ...a, type: 'ipps' }]).length, 1);
});

test('IPv6 addresses go in brackets and sort after IPv4', () => {
  const a: FoundService = { name: 'V6', type: 'ipp', port: 631, addresses: ['2401:4900::1'], txt: { ty: 'V6', UUID: 'v6' } };
  assert.equal(mergeFound([a])[0].address, 'ipp://[2401:4900::1]:631/ipp/print');
});

test('a saved printer is found again at its new address by uuid', () => {
  const found = mergeFound([{ ...ipp, addresses: ['192.168.1.77'] }]);
  assert.equal(relocate({ uuid: 'cfe92100-67c4-11d4-a45f-d4808b1c0ba2', name: 'whatever' }, found)?.address, 'ipp://192.168.1.77:631/ipp/print');
  assert.equal(relocate({ uuid: 'other', name: 'EPSON L3250 Series' }, found), null);
});

test('without a uuid, the name is used only when it is unambiguous', () => {
  const a: FoundService = { name: 'Same', type: 'ipp', port: 631, addresses: ['10.0.0.2'], txt: { ty: 'Same', UUID: 'a' } };
  const b: FoundService = { name: 'Same', type: 'ipp', port: 631, addresses: ['10.0.0.3'], txt: { ty: 'Same', UUID: 'b' } };
  assert.equal(relocate({ name: 'Same' }, mergeFound([a]))?.address, 'ipp://10.0.0.2:631/ipp/print');
  assert.equal(relocate({ name: 'Same' }, mergeFound([a, b])), null);
});
