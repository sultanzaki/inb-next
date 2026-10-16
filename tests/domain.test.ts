import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, parseNumber, evaluateParam, productSchema, inspectionSchema, documentSchema, issueSchema } from '../src/lib/domain/validation';
import { canAction } from '../src/lib/types';
import { dataUrl } from '../src/lib/data-access';

test('strict finite numeric parsing including Indonesian decimals', () => {
  for (const s of ['', '12abc', '0x10', 'Infinity', '1,2,3', '1e9999']) assert.equal(parseNumber(s), null, s);
  assert.equal(parseNumber('1,5'), 1.5); assert.equal(parseNumber(' -2.5e2 '), -250);
  assert.equal(evaluateParam({ tipe_batas: 'MAX', nilai_min: '', nilai_maks: '1,2' }, '1,5'), 'FAIL');
  assert.equal(evaluateParam({ tipe_batas: 'MIN', nilai_min: '2', nilai_maks: '' }, '2'), 'PASS');
  assert.equal(evaluateParam({ tipe_batas: 'RANGE', nilai_min: '', nilai_maks: '' }, '2'), 'FAIL');
});
test('business date uses Jakarta on both sides of UTC midnight', () => {
  assert.equal(businessDate(new Date('2026-10-15T18:00:00Z')), '2026-10-16');
  assert.equal(businessDate(new Date('2026-10-15T16:59:00Z')), '2026-10-15');
});
test('malformed payloads fail validation rather than throwing', () => {
  for (const schema of [productSchema, inspectionSchema, documentSchema, issueSchema])
    for (const value of [null, [], {}, { id: 123 }, { kode_produk: {} }]) assert.equal(schema.safeParse(value).success, false);
});
test('permission map fails closed for unknown actions and viewer writes', () => {
  assert.equal(canAction('admin qc', 'typo'), false); assert.equal(canAction('viewer', 'create_produk'), false);
  assert.equal(canAction('qc supervisor', 'issue_coa'), true); assert.equal(canAction('qc supervisor', 'delete_coa'), false);
});
test('gateway refuses sensitive tables, RPC names, traversal, and unbounded limits', () => {
  for (const t of ['users', 'sessions', 'audit_log', '../users', 'rpc/qc_mutate']) assert.equal(dataUrl('https://example.com', t, ''), null);
  assert.equal(dataUrl('https://example.com', 'master_produk', '?limit=1001'), null);
  const url = dataUrl('https://example.com', 'hasil_uji', '?or=(product_name.ilike.*QC*)&limit=50');
  assert.equal(url?.pathname, '/rest/v1/hasil_uji'); assert.equal(url?.searchParams.get('limit'), '50');
});

test('password verification handles scrypt, malformed hashes and legacy migration without accepting public default', async () => {
 const hash = await hashPassword('a secure test password');
 assert.equal(await verifyPassword('a secure test password', hash), true);
 assert.equal(await verifyPassword('wrong', hash), false);
 for (const malformed of ['scrypt$not-hex$00', 'scrypt$'+ '00'.repeat(16)+'$ff', 'invalid'])
  assert.equal(await verifyPassword('anything', malformed), false);
 const legacy = (p: string) => createHash('sha256').update('INBIO::'+p).digest('hex');
 assert.equal(await verifyPassword('Legacy password', legacy('Legacy password')), true);
 assert.equal(await verifyPassword('INBIONUSA', legacy('INBIONUSA')), false);
 assert.equal(await verifyPassword('INBIONUSA', await hashPassword('INBIONUSA')), false);
});
