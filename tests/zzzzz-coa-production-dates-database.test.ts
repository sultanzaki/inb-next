import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
before(async () => {
  await db.connect();
  const sql = await readFile(
    new URL(
      "../src/lib/db/migrations/016_coa_production_dates.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
});
after(() => db.end());
async function fixture(stocked = true) {
  const key = randomUUID();
  const uid = (
    await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'test-only','administrator inbionusa','COA date test') returning id",
      [key],
    )
  ).rows[0].id;
  const token = randomUUID();
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [uid, token],
  );
  await db.query("update erp_modules set state='active' where key='quality'");
  const pid = (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,tipe_kemasan) values($1,'STEARATE 200','Chemical','kg','Bag') returning id",
      [key],
    )
  ).rows[0].id;
  const hid = (
    await db.query(
      "insert into hasil_uji(id_produk,no_lot,tgl_sampling,tgl_uji,inspector,hasil_detail,status,qc_version) values($1,$2,erp_today()-1,erp_today()-1,'QC test',$3,'PASS',1) returning id",
      [
        pid,
        key,
        JSON.stringify([
          { p: "Assay", t: "MIN", mn: "1", mx: "", val: "2", st: "PASS" },
        ]),
      ],
    )
  ).rows[0].id;
  const lid = (
    await db.query(
      "insert into erp_lots(product_id,number,inspection_id,qc_status,mfg_date,expiry_date) values($1,$2,$3,'released','2026-10-20','2027-10-20') returning id",
      [pid, key, hid],
    )
  ).rows[0].id;
  if (stocked) {
    const loc = (
      await db.query(
        "insert into erp_locations(code,name) values($1,'COA test stock') returning id",
        [key.slice(0, 20)],
      )
    ).rows[0].id;
    const mid = (
      await db.query(
        "insert into erp_movements(number,kind,state,date,lines,created_by) values($1,'production','posted','2026-10-20','[]',$2) returning id",
        [key, uid],
      )
    ).rows[0].id;
    await db.query(
      "insert into erp_ledger(movement_id,line,lot_id,location_id,delta) values($1,1,$2,$3,10)",
      [mid, lid, loc],
    );
  }
  return { token, hid, lid };
}
async function rpc(token: string, hid: string, date: string) {
  return db.query("select qc_mutate($1,'issue_coa',$2)", [
    token,
    {
      id_hasil: hid,
      no_coa: "",
      mfg_date: date,
      tanggal_rilis: "2026-10-21",
      tanggal_expired: date.replace("2026", "2027"),
      tanda_tangan: "Date test",
      language: "en",
    },
  ]);
}
test("COA source exposes posted production dates without opening warehouse table access", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    await db.query("set local role service_role");
    const source = (
      await db.query("select coa_lot from available_hasil_uji where id=$1", [
        f.hid,
      ])
    ).rows[0].coa_lot;
    assert.deepEqual(source, {
      mfg_date: "2026-10-20",
      expiry_date: "2027-10-20",
      locked: true,
      source: "production",
    });
    await db.query("reset role");
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'qc_coa_lot_dates(uuid)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('service_role','erp_lots','SELECT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.query("savepoint wrong_date");
    await assert.rejects(
      () => rpc(f.token, f.hid, "2026-10-21"),
      /COA dates must match/,
    );
    await db.query("rollback to savepoint wrong_date");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from coa where id_hasil_uji=$1",
          [f.hid],
        )
      ).rows[0].n,
      0,
    );
    await rpc(f.token, f.hid, "2026-10-20");
    const coa = (
      await db.query(
        "select mfg_date,tanggal_expired::text,tanggal_rilis::text from coa where id_hasil_uji=$1",
        [f.hid],
      )
    ).rows[0];
    assert.deepEqual(coa, {
      mfg_date: "2026-10-20",
      tanggal_expired: "2027-10-20",
      tanggal_rilis: "2026-10-21",
    });
    assert.equal(
      (
        await db.query("select mfg_date::text d from erp_lots where id=$1", [
          f.lid,
        ])
      ).rows[0].d,
      "2026-10-20",
    );
  } finally {
    await db.query("rollback");
  }
});
test("Unposted legacy lots retain manual COA dates", async () => {
  await db.query("begin");
  try {
    const f = await fixture(false);
    assert.equal(
      (
        await db.query("select coa_lot from available_hasil_uji where id=$1", [
          f.hid,
        ])
      ).rows[0].coa_lot.locked,
      false,
    );
    await rpc(f.token, f.hid, "2026-10-21");
  } finally {
    await db.query("rollback");
  }
});
