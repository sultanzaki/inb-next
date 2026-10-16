import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PostgrestClient } from '@supabase/postgrest-js';
const base = 'http://127.0.0.1:55433';
const jwt = (role: string) => {
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return body + '.' + createHmac('sha256', 'inb-next-integration-only-jwt-secret-32chars').update(body).digest('base64url');
};
const service = new PostgrestClient(base, { headers: { Authorization: 'Bearer ' + jwt('service_role') } });
test('real PostgREST denies anonymous sensitive reads', async () => {
  const anon = new PostgrestClient(base);
  for (const t of ['users', 'sessions', 'master_produk', 'audit_log']) assert.equal((await anon.from(t).select('*')).status, 401);
});
test('cross-table searches work with scalar computed product_name', async () => {
  for (const [table, field] of [['hasil_uji', 'no_lot'], ['coa', 'no_coa']]) {
    const result = await service.from(table).select('id,master_produk!inner(kode_produk,nama_produk)').or(`${field}.ilike."%lot%",product_name.ilike."%Produk%"`);
    assert.equal(result.error, null, JSON.stringify(result.error)); assert.equal(result.status, 200);
  }
});
test('available-source view supports relation embedding and exact count', async () => {
  const result = await service.from('available_hasil_uji').select('id,master_produk!inner(kode_produk,nama_produk)', { count: 'exact' }).range(0, 499);
  assert.equal(result.error, null, JSON.stringify(result.error)); assert.equal(typeof result.count, 'number');
});
