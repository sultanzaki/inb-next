import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Client } from 'pg';

// This runner ONLY accepts the explicit loopback disposable database.
const connectionString = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-test-only@127.0.0.1:55432/postgres';
const target = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '55432') throw new Error('Use only the isolated test database on loopback port 55432.');
const db = new Client({ connectionString });
let token: string, viewer: string, supervisor: string;
let product: string;
const spec = { parameter_uji: 'pH', tipe_batas: 'RANGE', nilai_min: '6', nilai_maks: '8', satuan: '', keterangan: '' };
const productPayload = (code = randomUUID()) => ({ kode_produk: code, nama_produk: 'Produk Uji', kategori: 'QC', satuan: 'Kg', status_halal: 'Halal', tipe_kemasan: 'Botol', spesifikasi: [spec] });
async function rpc(action: string, payload: unknown, session = token, client = db) {
  return (await client.query('select qc_mutate($1,$2,$3::jsonb) result', [session, action, JSON.stringify(payload)])).rows[0].result;
}
async function inspection(val = '7', lot = randomUUID(), id_produk = product) {
  const { rows } = await db.query('select id from spesifikasi where id_produk=$1 order by urutan,id', [id_produk]);
  return { id_produk, no_lot: lot, tgl_sampling: '2026-01-01', tgl_uji: '2026-01-02', inspector: 'Tester', catatan: '', status: 'PASS', hasil_detail: [{ spec_id: rows[0].id, p: 'pH', val, st: 'PASS' }] };
}
async function source() { return (await rpc('create_uji', await inspection())).id as string; }
const coa = (id_hasil: string, no_coa = '') => ({ id_hasil, no_coa, tanggal_rilis: '2026-01-03', tanggal_expired: '2027-01-03', mfg_date: '2026-01-01', tanda_tangan: 'Tester' });
async function denied(fn: () => Promise<unknown>, code: string) { await assert.rejects(fn, (e: unknown) => (e as { code: string }).code === code); }

before(async () => {
  await db.connect();
  // Only tests own this disposable schema. Never use a production connection.
  await db.query('drop schema public cascade; create schema public; grant usage on schema public to public');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (!(await db.query('select from pg_roles where rolname=$1', [role])).rowCount)
      await db.query(`create role ${role} ${role === 'service_role' ? 'bypassrls' : ''}`);
  }
  for (const file of ['schema.sql', 'migrations/001_private_access.sql', 'migrations/002_integrity.sql'])
    await db.query(await readFile(new URL('../src/lib/db/' + file, import.meta.url), 'utf8'));
  const tokens: string[] = [];
  for (const role of ['admin qc', 'viewer', 'qc supervisor']) {
    const user = (await db.query('insert into users(username,password_hash,role,nama_lengkap) values($1,$2,$3,$4) returning id', [randomUUID(), 'fixture', role, role])).rows[0];
    const t = randomUUID(); tokens.push(t);
    await db.query("insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')", [user.id, t]);
  }
  [token, viewer, supervisor] = tokens;
  product = (await rpc('create_produk', productPayload())).id;
});
after(async () => { await db.end(); });

test('setup schema and migrations are repeatable', async () => {
  for (const file of ['schema.sql', 'migrations/001_private_access.sql', 'migrations/002_integrity.sql'])
    await db.query(await readFile(new URL('../src/lib/db/' + file, import.meta.url), 'utf8'));
});
test('anonymous/authenticated cannot read hashes, sessions, or domain data or call RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.query('set role ' + role);
    try {
      for (const table of ['users', 'sessions', 'master_produk', 'spesifikasi', 'hasil_uji', 'coa', 'audit_log', 'available_hasil_uji'])
        await denied(() => db.query(`select * from ${table}`), '42501');
      await denied(() => db.query('select qc_mutate($1,$2,$3)', [token, 'delete_produk', JSON.stringify({ id: product })]), '42501');
      await denied(() => db.query('select qc_reserve_login($1)', ['a'.repeat(64)]), '42501');
    } finally { await db.query('reset role'); }
  }
});
test('service role can execute authorized mutations and transactional audit', async () => {
  await db.query('set role service_role');
  try { await rpc('create_produk', productPayload()); } finally { await db.query('reset role'); }
  assert.ok((await db.query('select from audit_log where user_name=$1', ['admin qc'])).rowCount);
});
test('viewer, expired sessions, unknown actions, and supervisor deletion fail closed', async () => {
  await denied(() => rpc('create_produk', productPayload(), viewer), '42501');
  await denied(() => rpc('made_up', {}, token), '42501');
  await denied(() => rpc('delete_produk', { id: product }, supervisor), '42501');
  await denied(() => rpc('create_produk', productPayload(), randomUUID()), '42501');
  const expired = randomUUID();
  await db.query("insert into sessions(user_id,token,expires_at) select user_id,$1,now()-interval '1 second' from sessions where token=$2",[expired,token]);
  await denied(() => rpc('create_produk', productPayload(), expired), '42501');
});
test('invalid specs roll back the entire new product and its audit', async () => {
  const code = randomUUID(), p = productPayload(code); p.spesifikasi[0] = { ...spec, nilai_min: '9', nilai_maks: '1' };
  const old = (await db.query('select count(*) from audit_log')).rows[0].count;
  await denied(() => rpc('create_produk', p), '23514');
  assert.equal((await db.query('select from master_produk where kode_produk=$1', [code])).rowCount, 0);
  assert.equal((await db.query('select count(*) from audit_log')).rows[0].count, old);
});
test('invalid edit restores product metadata and old specs atomically', async () => {
  const old = (await db.query('select * from master_produk where id=$1', [product])).rows[0];
  const specs = (await db.query('select * from spesifikasi where id_produk=$1', [product])).rows;
  const p = { ...productPayload(), id: product, nama_produk: 'Should roll back', spesifikasi: [{ ...spec, nilai_maks: 'invalid' }] };
  await denied(() => rpc('update_produk', p), '23514');
  assert.deepEqual((await db.query('select * from master_produk where id=$1', [product])).rows[0], old);
  assert.deepEqual((await db.query('select * from spesifikasi where id_produk=$1', [product])).rows, specs);
});
test('duplicate parameter names are rejected case-insensitively', async () => {
  await denied(() => rpc('create_produk', { ...productPayload(), spesifikasi: [spec, { ...spec, parameter_uji: 'PH' }] }), '23505');
});
test('server overrides forged PASS and forged limits', async () => {
  const p = await inspection('99'); p.hasil_detail[0].st = 'PASS';
  const result = await rpc('create_uji', p);
  const row = (await db.query('select * from hasil_uji where id=$1', [result.id])).rows[0];
  assert.equal(row.status, 'FAIL'); assert.equal(row.hasil_detail[0].st, 'FAIL'); assert.equal(row.hasil_detail[0].mx, '8');
  await denied(() => rpc('issue_coa', coa(result.id)), '23514');
});
test('numeric grammar rejects suffixes/hex/Infinity and accepts comma decimals', async () => {
  for (const v of ['12abc', '0x10', 'Infinity', '1e9999']) await denied(async () => rpc('create_uji', await inspection(v)), '23514');
  const id = (await rpc('create_uji', await inspection('6,5'))).id;
  assert.equal((await db.query('select status from hasil_uji where id=$1', [id])).rows[0].status, 'PASS');
});
test('missing, duplicate, and stale parameters cannot be saved', async () => {
  const p = await inspection();
  await denied(() => rpc('create_uji', { ...p, hasil_detail: [] }), '23514');
  await denied(() => rpc('create_uji', { ...p, hasil_detail: [p.hasil_detail[0], p.hasil_detail[0]] }), '23514');
  await denied(() => rpc('create_uji', { ...p, hasil_detail: [{ ...p.hasil_detail[0], spec_id: randomUUID() }] }), '55000');
});
test('date ordering enforced for inspections, COAs, documents', async () => {
  await denied(async () => rpc('create_uji', { ...await inspection(), tgl_uji: '2025-01-01' }), '23514');
  const id = await source();
  await denied(() => rpc('issue_coa', { ...coa(id), tanggal_expired: '2020-01-01' }), '23514');
  await denied(() => rpc('create_doc', { judul_dokumen: 'Doc', kategori: 'QC', tanggal_berlaku: '2026-01-01', masa_kadaluarsa: '2025-01-01', link_drive: '' }), '23514');
});
test('missing update/delete target is a not-found error', async () => {
  for (const action of ['delete_produk', 'delete_uji', 'delete_coa', 'delete_doc'])
    await denied(() => rpc(action, { id: randomUUID() }), 'P0002');
  await denied(() => rpc('update_produk', { ...productPayload(), id: randomUUID() }), 'P0002');
});
test('COA snapshot stays unchanged after master rename; certified results are locked', async () => {
  const id = await source(), cert = await rpc('issue_coa', coa(id));
  const snapshot = (await db.query('select hasil_uji_snapshot from coa where id=$1', [cert.id])).rows[0].hasil_uji_snapshot;
  await rpc('update_produk', { ...productPayload(), id: product, nama_produk: 'Changed master' });
  assert.deepEqual((await db.query('select hasil_uji_snapshot from coa where id=$1', [cert.id])).rows[0].hasil_uji_snapshot, snapshot);
  assert.equal(snapshot.produk, 'Produk Uji'); assert.ok(snapshot.kode_produk);
  await denied(async () => rpc('update_uji', { ...await inspection(), id }), '55000');
  await denied(() => rpc('delete_uji', { id }), '55000');
  await denied(() => db.query("update coa set hasil_uji_snapshot='{}' where id=$1", [cert.id]), '55000');
});
test('number allocation handles custom strings and 9999 -> 10000 -> 10001', async () => {
  const year = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' });
  await rpc('issue_coa', coa(await source(), 'ZZZ'));
  await rpc('issue_coa', coa(await source(), `COA/IBN/${year}/9999`));
  const first = await rpc('issue_coa', coa(await source())), second = await rpc('issue_coa', coa(await source()));
  assert.equal(first.no_coa, `COA/IBN/${year}/10000`); assert.equal(second.no_coa, `COA/IBN/${year}/10001`);
});
test('concurrent issuance of one source produces exactly one certificate', async () => {
  const id = await source();
  const clients = await Promise.all([0, 1].map(async () => { const c = new Client({ connectionString }); await c.connect(); return c; }));
  try {
    const result = await Promise.allSettled(clients.map(c => rpc('issue_coa', coa(id), token, c)));
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await db.query('select from coa where id_hasil_uji=$1', [id])).rowCount, 1);
  } finally { await Promise.all(clients.map(c => c.end())); }
});
test('concurrent different sources get distinct automatic numbers', async () => {
  const ids = [await source(), await source()];
  const clients = await Promise.all(ids.map(async () => { const c = new Client({ connectionString }); await c.connect(); return c; }));
  try {
    const result = await Promise.all(clients.map((c, i) => rpc('issue_coa', coa(ids[i]), token, c)));
    assert.notEqual(result[0].no_coa, result[1].no_coa);
  } finally { await Promise.all(clients.map(c => c.end())); }
});
test('audit failure rolls back business changes', async () => {
  await db.query("create function test_audit_failure() returns trigger language plpgsql as $$begin raise exception 'simulated audit outage'; end$$; create trigger test_failure before insert on audit_log for each row execute function test_audit_failure()");
  const code = randomUUID();
  try { await assert.rejects(() => rpc('create_produk', productPayload(code))); }
  finally { await db.query('drop trigger test_failure on audit_log; drop function test_audit_failure()'); }
  assert.equal((await db.query('select from master_produk where kode_produk=$1', [code])).rowCount, 0);
});
test('updated_at advances automatically', async () => {
  const before = (await db.query('select updated_at from master_produk where id=$1', [product])).rows[0].updated_at;
  await rpc('update_produk', { ...productPayload(), id: product });
  const after = (await db.query('select updated_at from master_produk where id=$1', [product])).rows[0].updated_at;
  assert.ok(after > before);
});
test('shared rate limit admits at most five concurrent attempts', async () => {
  const key = createHash('sha256').update(randomUUID()).digest('hex');
  const clients = await Promise.all(Array.from({ length: 8 }, async () => { const c = new Client({ connectionString }); await c.connect(); return c; }));
  try {
    const r = await Promise.all(clients.map(c => c.query('select qc_reserve_login($1) allowed', [key])));
    assert.equal(r.filter(x => x.rows[0].allowed).length, 5);
  } finally { await Promise.all(clients.map(c => c.end())); }
});
test('available results excludes issued rows without the old 500-row cap', async () => {
  const id = await source();
  assert.equal((await db.query('select from available_hasil_uji where id=$1', [id])).rowCount, 1);
  await rpc('issue_coa', coa(id));
  assert.equal((await db.query('select from available_hasil_uji where id=$1', [id])).rowCount, 0);
});

test('historical validated results cannot silently adopt replaced specifications', async () => {
 const p = (await rpc('create_produk',productPayload())).id;
 const id = (await rpc('create_uji',await inspection('7',randomUUID(),p))).id;
 await rpc('update_produk',{...productPayload(),id:p});
 await denied(async()=>rpc('update_uji',{...await inspection('7',randomUUID(),p),id}),'55000');
});
test('expired shared limiter resets once under concurrency', async () => {
 const key=createHash('sha256').update(randomUUID()).digest('hex');
 await db.query("insert into qc_login_attempts(key,count,reset_at) values($1,5,now()-interval '1 second')",[key]);
 const clients=await Promise.all(Array.from({length:8},async()=>{const c=new Client({connectionString});await c.connect();return c;}));
 try {const results=await Promise.all(clients.map(c=>c.query('select qc_reserve_login($1) allowed',[key])));assert.equal(results.filter(r=>r.rows[0].allowed).length,5);}
 finally{await Promise.all(clients.map(c=>c.end()));}
});
