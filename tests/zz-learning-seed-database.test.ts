import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
let sql: string;
before(async () => {
  await db.connect();
  sql = (
    await readFile(
      new URL("../scripts/seed-learning.sql", import.meta.url),
      "utf8",
    )
  )
    .replace(/^begin;$/m, "")
    .replace(/^commit;$/m, "");
});
after(() => db.end());
test("Learning seed leaves accounts/settings intact and creates actionable, reconciled training examples", async () => {
  await db.query("begin");
  try {
    await db.query(
      "update erp_modules set state='active' where key in ('quality','warehouse','sales','purchase','service','finance')",
    );
    const users = (
      await db.query("select to_jsonb(u) row from users u order by id")
    ).rows;
    const sessions = (await db.query("select count(*)::int n from sessions"))
      .rows[0].n;
    const modules = (await db.query("select * from erp_modules order by key"))
      .rows;
    await db.query(sql);
    assert.deepEqual(
      (await db.query("select to_jsonb(u) row from users u order by id")).rows,
      users,
    );
    assert.equal(
      (await db.query("select count(*)::int n from sessions")).rows[0].n,
      sessions,
    );
    assert.deepEqual(
      (await db.query("select * from erp_modules order by key")).rows,
      modules,
    );
    assert.equal(
      (await db.query("select count(*)::int n from _learning_examples")).rows[0]
        .n,
      26,
    );
    const outcomes = (
      await db.query(
        "select c.name,(erp_fin_dispatch_status(o.id)->>'cleared')::boolean cleared from erp_orders o join erp_quotes q on q.id=o.quote_id join erp_customers c on c.id=q.customer_id where c.name like 'DEMO-LEARN %'",
      )
    ).rows;
    const cleared = (label: string) =>
      outcomes.find((r) => r.name === "DEMO-LEARN " + label)?.cleared;
    assert.equal(cleared("PREPAID-TERMS-PENDING"), false);
    assert.equal(cleared("VERIFIED-NOT-ALLOCATED"), false);
    assert.equal(cleared("PREPAID-CLEARED"), true);
    assert.equal(cleared("DP-BALANCE-BEFORE-SHIP"), false);
    assert.equal(cleared("DP-PLUS-CREDIT"), true);
    assert.equal(cleared("CREDIT-LIMIT-BLOCKED"), false);
    assert.equal(cleared("CREDIT-READY"), true);
    const claims = (
      await db.query(
        "select c.id,c.resolution,erp_fin_case_settled(c.id,c.resolution)::text settled,cu.name from erp_cases c join erp_orders o on o.id=case when c.source_type='order' then c.source_id else (c.source_snapshot->>'order_id')::uuid end join erp_quotes q on q.id=o.quote_id join erp_customers cu on cu.id=q.customer_id where c.title like 'DEMO-LEARN%'",
      )
    ).rows;
    assert.equal(
      Number(claims.find((r) => r.name.endsWith("REFUND-PARTIAL")).settled),
      600000,
    );
    assert.equal(
      Number(claims.find((r) => r.name.endsWith("REFUND-COMPLETE")).settled),
      1000000,
    );
    assert.equal(
      Number(claims.find((r) => r.name.endsWith("CREDIT-NOT-APPLIED")).settled),
      0,
    );
    assert.equal(
      Number(claims.find((r) => r.name.endsWith("CREDIT-APPLIED")).settled),
      1000000,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_fin_document_view where number like 'DEMO-LEARN %AGING%' and outstanding=2000000",
        )
      ).rows[0].n,
      10,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_balances b join erp_lots l on l.id=b.lot_id where l.number='DEMO-LEARN-LOT-01' and b.quantity<>(select sum(delta) from erp_ledger where lot_id=b.lot_id and location_id=b.location_id)",
        )
      ).rows[0].n,
      0,
    );
    // Simulate ON COMMIT DROP for the seed context before replaying in this test transaction.
    await db.query("drop table pg_temp._learning_config");
    await db.query("savepoint duplicate_seed");
    await assert.rejects(() => db.query(sql), /DEMO-LEARN examples already exist/);
    await db.query("rollback to savepoint duplicate_seed");
  } finally {
    await db.query("rollback");
  }
});
test("Learning seed reports inactive modules before creating business data or sessions", async () => {
  await db.query("begin");
  try {
    await db.query(
      "update erp_modules set state='disabled' where key='finance'",
    );
    const users = (await db.query("select count(*)::int n from users")).rows[0]
      .n;
    await db.query("savepoint inactive_module");
    await assert.rejects(
      () => db.query(sql),
      /Activate these modules first:.*finance/,
    );
    await db.query("rollback to savepoint inactive_module");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from master_produk where kode_produk like 'DEMO-LEARN-%'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from users")).rows[0].n,
      users,
    );
  } finally {
    await db.query("rollback");
  }
});
