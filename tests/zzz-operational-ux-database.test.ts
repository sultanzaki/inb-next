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
    new URL("../src/lib/db/migrations/014_operational_ux.sql", import.meta.url),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
});
after(() => db.end());
test("UX choices apply context before pagination, preserve authorization and expose document flow", async () => {
  await db.query("begin");
  try {
    await db.query(
      "update erp_modules set state='active' where key in ('finance','sales','warehouse','purchase')",
    );
    const actor = (
      await db.query(
        "insert into users(username,password_hash,role,nama_lengkap) values($1,'test-only','administrator inbionusa','UX fixture') returning id",
        [randomUUID()],
      )
    ).rows[0].id;
    const token = randomUUID();
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [actor, token],
    );
    const party = (
      await db.query(
        "insert into erp_customers(name) values('UX chemical customer') returning id",
      )
    ).rows[0].id;
    const root = randomUUID(),
      number = "UX-SO-" + root;
    const quote = (
      await db.query(
        "insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]','{\"total\":\"60000000\"}',$4) returning id",
        ["UX-Q-" + root, root, party, actor],
      )
    ).rows[0].id;
    const order = (
      await db.query(
        "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
        [
          number,
          quote,
          root,
          {
            customer: { name: "UX chemical customer" },
            currency: "IDR",
            totals: { total: "60000000" },
          },
        ],
      )
    ).rows[0].id;
    await db.query(
      "insert into erp_fin_terms(order_id,mode,deposit_percent,billing_event,state,created_by) values($1,'deposit_credit',30,'dispatch','approved',$2)",
      [order, actor],
    );
    const doc = (
      await db.query(
        "insert into erp_fin_documents(number,kind,party_type,party_id,order_id,currency,amount,date,due_date,state,snapshot,created_by) values($1,'payment_request','customer',$2,$3,'IDR',18000000,erp_today(),erp_today(),'issued','{}',$4) returning id",
        ["UX-PR-" + root, party, order, actor],
      )
    ).rows[0].id;
    await db.query(
      "insert into erp_fin_payments(number,direction,party_type,party_id,currency,amount,date,bank_account,bank_reference,evidence,state,created_by) select 'UX-PAY-'||g||'-'||$1,'receipt','customer',$2,'IDR',100,erp_today(),'test',g::text,'test evidence',case when g=60 then 'verified' else 'draft' end,$3 from generate_series(1,60) g",
      [root, party, actor],
    );
    async function choices(entity: string, search = "", scope: object = {}) {
      return (
        await db.query("select erp_choices($1,$2,$3,1,$4) r", [
          token,
          entity,
          search,
          scope,
        ])
      ).rows[0].r;
    }
    const payments = await choices("fin_payments", "", {
      party_id: party,
      currency: "IDR",
      state: "verified",
      positive: true,
    });
    assert.equal(payments.total, 1);
    assert.equal(payments.rows[0].state, "verified");
    const docs = await choices("fin_documents", "UX chemical", {
      party_id: party,
      state: "issued",
      positive: true,
    });
    assert.equal(docs.total, 1);
    assert.equal(docs.rows[0].id, doc);
    const detail = (
      await db.query("select erp_read($1,'fin_orders','','',1,$2) r", [
        token,
        order,
      ])
    ).rows[0].r.rows[0];
    assert.equal(detail.billing.requested, "18000000.000000");
    assert.equal(detail.billing.paid, "0");
    assert.ok(
      (await choices("fin_orders", "UX chemical")).rows.some(
        (r: { id: string }) => r.id === order,
      ),
    );
    const flow = (
      await db.query("select erp_document_flow($1,'orders',$2) r", [
        token,
        order,
      ])
    ).rows[0].r;
    assert.ok(flow.rows.some((r: { id: string }) => r.id === doc));
    assert.ok(flow.rows.some((r: { id: string }) => r.id === quote));
    const movement = (
      await db.query(
        "insert into erp_movements(number,kind,state,date,lines,order_id,created_by) values($1,'delivery','posted',erp_today(),'[]',$2,$3) returning id",
        ["UX-DO-" + root, order, actor],
      )
    ).rows[0].id;
    assert.equal(
      (await choices("posted_deliveries", "", { order_id: order })).rows[0].id,
      movement,
    );
    assert.equal(
      (await choices("posted_deliveries", "", { order_id: randomUUID() }))
        .total,
      0,
    );
    const readiness = (
      await db.query("select erp_delivery_readiness($1,$2) r", [
        token,
        movement,
      ])
    ).rows[0].r.rows[0];
    assert.equal(readiness.checks.length, 5);
    assert.equal(readiness.ready, false);
    assert.equal(
      readiness.checks.find((c: { id: string }) => c.id === "finance").ready,
      false,
    );
    await db.query(
      "update erp_modules set state='active' where key='production'",
    );
    const product = (
      await db.query(
        "insert into master_produk(kode_produk,nama_produk,kategori,satuan,tipe_kemasan) values($1,'UX STEARATE 99','Chemical','kg','Bag') returning id",
        ["UX-" + root],
      )
    ).rows[0].id;
    const series = BigInt("0x" + root.replaceAll("-", ""))
      .toString()
      .slice(0, 20);
    await db.query(
      "insert into erp_product_series(product_id,series) values($1,$2)",
      [product, series],
    );
    const batch = (
      await db.query("select erp_batch_preview($1,$2,'2028-02-29') r", [
        token,
        product,
      ])
    ).rows[0].r.rows[0];
    assert.equal(batch.number, series + ".01.29022028.2029");
    assert.equal(batch.expiry_date, "2029-02-28");
    const line = (
      await db.query(
        'insert into erp_order_lines(order_id,position,product_id,quantity,delivered,snapshot) values($1,1,$2,10,10,\'{"product":"UX STEARATE","amount":"10"}\') returning id',
        [order, product],
      )
    ).rows[0].id;
    const delivery = (
      await db.query(
        "insert into erp_movements(number,kind,state,date,lines,order_id,created_by) values($1,'delivery','posted',erp_today(),$2,$3,$4) returning id",
        [
          "UX-SPLIT-" + root,
          JSON.stringify([
            { order_line_id: line, base_quantity: "4" },
            { order_line_id: line, base_quantity: "6" },
          ]),
          order,
          actor,
        ],
      )
    ).rows[0].id;
    await db.query(
      "insert into erp_fin_documents(number,kind,party_type,party_id,order_id,currency,amount,date,due_date,state,snapshot,lines,created_by) values($1,'invoice','customer',$2,$3,'IDR',4,erp_today(),erp_today(),'issued','{}',$4,$5)",
      [
        "UX-INV-" + root,
        party,
        order,
        JSON.stringify([{ line_id: line, quantity: "4" }]),
        actor,
      ],
    );
    const billable = (
      await choices("posted_deliveries", "UX-SPLIT-" + root, {
        order_id: order,
      })
    ).rows.find((r: { id: string }) => r.id === delivery).billing_lines;
    assert.equal(
      billable.length,
      1,
      "multiple lots for one order line form one invoice line",
    );
    assert.equal(
      Number(billable[0].unbilled),
      6,
      "remaining quantity also respects prior order-level invoices",
    );
    // Module-specific role must not gain Finance access through new helpers.
    await db.query("update users set role='warehouse_operator' where id=$1", [
      actor,
    ]);
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [actor, token],
    );
    await db.query("savepoint unauthorized");
    await assert.rejects(
      () => choices("fin_payments"),
      (e: unknown) => (e as { code: string }).code === "42501",
    );
    await db.query("rollback to savepoint unauthorized");
    const restrictedFlow = (
      await db.query("select erp_document_flow($1,'movements',$2) r", [
        token,
        movement,
      ])
    ).rows[0].r;
    assert.ok(
      restrictedFlow.rows.every(
        (r: { module: string }) => r.module === "warehouse",
      ),
    );
  } finally {
    await db.query("rollback");
  }
});
