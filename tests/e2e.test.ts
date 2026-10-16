import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { chromium } from 'playwright';

const dbUrl = 'postgres://postgres:local-test-only@127.0.0.1:55432/postgres';
const origin = 'http://127.0.0.1:3004';
function jwt(role: string) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return body + '.' + createHmac('sha256', 'inb-next-integration-only-jwt-secret-32chars').update(body).digest('base64url');
}

test('production app: authenticated reads, pagination, mutations, search, error handling and logout', { timeout: 180000 }, async () => {
  const db = new Client({ connectionString: dbUrl }); await db.connect();
  const salt = randomBytes(16), password = 'Local fixture password only';
  const username = 'e2e-' + randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const browserName = 'Browser Product ' + suffix;
  const browserLot = 'BROWSER-LOT-' + suffix;
  const { rows: [user] } = await db.query('insert into users(username,password_hash,role,nama_lengkap) values($1,$2,$3,$4) returning id', [username, `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`, 'admin qc', 'Pengujian Lokal']);
  await db.query("delete from master_produk where nama_produk like 'E2E Product %'");
  for (let i = 0; i < 120; i++) await db.query('insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,$2,$3,$4,$5,$6)', ['E2E-' + randomUUID(), 'E2E Product ' + String(i).padStart(3, '0'), 'QC', 'Kg', 'Halal', 'Botol']);
  // Supabase clients mount PostgREST at /rest/v1; the standalone test image
  // serves it at /. This local adapter mirrors only that path mounting.
  let failRevoke = false;
  const relay = createServer(async (req, res) => {
    if (failRevoke && req.method === 'DELETE' && req.url?.startsWith('/rest/v1/sessions')) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"message":"test revoke failure"}'); return; }
    const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
    const response = await fetch('http://127.0.0.1:55433' + req.url!.replace(/^\/rest\/v1/, ''), {
      method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k))) as Record<string, string>,
      body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(parts),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(resolve => relay.listen(55434, '127.0.0.1', resolve));
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3004'], {
    cwd: process.cwd(), env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:55434', SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }, stdio: 'ignore',
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(origin + '/login')).ok) { ready = true; break; } } catch { /* wait for owned server */ }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(ready, 'local production server started');
    assert.equal((await fetch(origin + '/api/data/master_produk')).status, 401);
    assert.equal((await fetch(origin + '/api/data/master_produk', { headers: { Authorization: 'Bearer ' + jwt('service_role') } })).status, 401);
    assert.equal((await fetch(origin + '/api/data/master_produk', { method: 'POST' })).status, 405);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TEST_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--disable-gpu'],
      env: { PATH: process.env.PATH!, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp/inb-test-browser', XDG_CACHE_HOME: '/tmp/inb-test-browser-cache' },
    });
    const context = await browser.newContext({ timezoneId: 'Asia/Jakarta' });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const runtimeErrors: string[] = []; page.on('pageerror', e => runtimeErrors.push(e.message));
    await page.goto(origin + '/login');
    await page.locator('[name=username]').fill(username); await page.locator('[name=password]').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL('**/dashboard');
    assert.equal((await page.request.get(origin + '/api/data/users')).status(), 400);
    assert.equal((await page.request.get(origin + '/api/data/sessions')).status(), 400);
    await page.goto(origin + '/dashboard/produk');
    await page.getByPlaceholder('Cari produk…').fill('E2E Product');
    await page.waitForFunction(() => document.querySelector('body')?.innerText.includes('120 data'));
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 50);
    await page.getByRole('button', { name: /Muat lagi/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 100);
    const rows = await page.locator('tbody tr').allTextContents(); assert.equal(new Set(rows).size, 100);
    await page.getByRole('button', { name: /Muat lagi/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 120);
    assert.equal(new Set(await page.locator('tbody tr').allTextContents()).size, 120);
    // Create product + canonical parameter using the real Server Action/RPC.
    await page.getByRole('button', { name: 'Produk Baru', exact: true }).first().click();
    await page.getByPlaceholder('PRD-001').fill('BROWSER-' + randomUUID());
    await page.getByPlaceholder('Nama produk', { exact: true }).fill(browserName);
    await page.getByRole('button', { name: 'Tambah Parameter' }).click();
    await page.getByPlaceholder('Parameter', { exact: true }).fill('pH');
    await page.getByPlaceholder('Min', { exact: true }).fill('6'); await page.getByPlaceholder('Maks', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Tambah', exact: true }).click();
    await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
    const p = (await db.query("select id from master_produk where nama_produk=$1 order by created_at desc limit 1", [browserName])).rows[0];
    assert.ok(p);
    await page.goto(origin + '/dashboard/inspeksi');
    await page.getByRole('button', { name: 'Input Uji Baru', exact: true }).first().click();
    await page.locator('[role=dialog] select').selectOption(p.id);
    await page.getByPlaceholder('0', { exact: true }).waitFor();
    await page.getByPlaceholder('LOT-001').fill(browserLot);
    await page.getByPlaceholder('Nama inspector').fill('Browser Tester');
    await page.getByPlaceholder('0', { exact: true }).fill('7,5');
    await page.getByRole('button', { name: 'Tambah', exact: true }).click();
    await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
    const h = (await db.query("select * from hasil_uji where id_produk=$1 and no_lot=$2", [p.id, browserLot])).rows[0];
    assert.equal(h.status, 'PASS'); assert.equal(h.hasil_detail[0].val, '7,5');
    await page.getByPlaceholder('Cari no lot atau produk…').fill(browserName);
    await page.getByRole('cell', { name: browserLot, exact: true }).waitFor();
    // Put the desired source beyond the first 500 available rows. It must
    // remain selectable; the old two capped queries would hide this source.
    await db.query(`insert into hasil_uji(id_produk,no_lot,tgl_sampling,tgl_uji,inspector,catatan,hasil_detail,status,qc_version)
      select id_produk,'EXTRA-'||i||'-'||$2,tgl_sampling,tgl_uji,inspector,catatan,hasil_detail,status,qc_version
      from hasil_uji cross join generate_series(1,501) i where id=$1`, [h.id, randomUUID()]);
    await page.goto(origin + '/dashboard/coa');
    await page.getByRole('button', { name: 'Terbitkan COA', exact: true }).first().click();
    await page.locator('[role=dialog] select option').filter({ hasText: browserLot }).waitFor({ state: 'attached' });
    await page.locator('[role=dialog] select').selectOption(h.id);
    const dates = page.locator('[role=dialog] input[type=date]');
    await dates.nth(1).fill('2027-12-31');
    await page.getByRole('button', { name: 'Terbitkan', exact: true }).click();
    await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
    assert.equal((await db.query('select * from coa where id_hasil_uji=$1', [h.id])).rowCount, 1);
    await db.query('update master_produk set nama_produk=$1 where id=$2',['Master renamed after certification',p.id]);
    await page.getByPlaceholder('Cari COA atau produk…').fill(browserName);
    await page.getByRole('cell', { name: browserLot, exact: true }).waitFor();
    await page.getByText(browserName, { exact: true }).waitFor();
    // Dependency errors must not masquerade as an empty source list.
    await page.route('**/api/data/available_hasil_uji?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test failure"}' }));
    await page.reload();
    await page.getByRole('button', { name: 'Terbitkan COA', exact: true }).first().click();
    await page.getByRole('alert').filter({ hasText: 'Gagal memuat hasil uji' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Terbitkan', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape'); await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
    await page.locator('button[aria-haspopup=true]').click();
    failRevoke = true;
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.getByText('Gagal keluar. Coba lagi.', { exact: true }).waitFor();
    assert.equal((await db.query('select from sessions where user_id=$1', [user.id])).rowCount, 1);
    assert.ok((await context.cookies()).some(c => c.name === 'session_token'));
    failRevoke = false;
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.waitForURL('**/login');
    assert.equal((await db.query('select from sessions where user_id=$1', [user.id])).rowCount, 0);
    assert.equal((await page.request.get(origin + '/api/data/master_produk')).status(), 401);
    assert.deepEqual(runtimeErrors, []);
  } finally {
    if (browser) await browser.close();
    app.kill(); relay.close(); await db.end();
  }
});
