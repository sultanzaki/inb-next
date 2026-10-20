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
  for (const file of [
    "014_operational_ux",
    "015_transaction_controls",
    "015_transaction_controls",
  ])
    await db.query(
      await readFile(
        new URL("../src/lib/db/migrations/" + file + ".sql", import.meta.url),
        "utf8",
      ),
    );
});
after(() => db.end());
async function rpc(token: string, action: string, payload: object) {
  return (
    await db.query("select erp_mutate($1,$2,$3) r", [token, action, payload])
  ).rows[0].r;
}
async function controls(token: string, entity: string, id: string) {
  return (
    await db.query("select erp_controls($1,$2,$3) r", [token, entity, id])
  ).rows[0].r.rows[0];
}
async function fails(fn: () => Promise<unknown>, pattern: RegExp) {
  await db.query("savepoint rejected");
  try {
    await assert.rejects(fn, pattern);
  } finally {
    await db.query("rollback to savepoint rejected");
  }
}
function tx(name: string, fn: () => Promise<void>) {
  test(name, async () => {
    await db.query("begin");
    try {
      await fn();
    } finally {
      await db.query("rollback");
    }
  });
}
async function account(role = "administrator inbionusa") {
  const id = (
    await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'test-only',$2,'Controls reviewer') returning id",
      [randomUUID(), role],
    )
  ).rows[0].id;
  const token = randomUUID();
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [id, token],
  );
  return { id, token };
}
async function fixture(delivered = 6) {
  await db.query(
    "update erp_modules set state='active' where key in ('sales','warehouse','finance','purchase','service')",
  );
  const user = await account(),
    key = randomUUID(),
    today = (await db.query("select erp_today()::text d")).rows[0].d;
  const customer = (
    await db.query("insert into erp_customers(name) values($1) returning id", [
      "Controls customer " + key,
    ])
  ).rows[0].id;
  const unit = (
    await db.query(
      "insert into erp_units(code,name) values($1,'Kilogram') returning id",
      [key.slice(0, 12)],
    )
  ).rows[0].id;
  const product = (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,tipe_kemasan) values($1,'STEARATE 01','Chemical','kg','Bag') returning id",
      [key],
    )
  ).rows[0].id;
  const location = (
    await db.query(
      "insert into erp_locations(code,name) values($1,'Controls warehouse') returning id",
      [key.slice(0, 20)],
    )
  ).rows[0].id;
  const lot = (
    await db.query(
      "insert into erp_lots(product_id,number,qc_status,mfg_date,expiry_date) values($1,$2,'released',erp_today(),erp_today()+365) returning id",
      [product, key],
    )
  ).rows[0].id;
  await db.query(
    "insert into erp_balances(lot_id,location_id,quantity) values($1,$2,20)",
    [lot, location],
  );
  const snapshot = {
    customer: { name: "Controls customer " + key },
    currency: "IDR",
    tax_rate: "10",
    totals: { subtotal: "100", tax: "10", freight: "0", total: "110" },
    lines: [],
  };
  const quote = (
    await db.query(
      "insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]',$4,$5) returning id",
      ["Q-C-" + key, key, customer, snapshot.totals, user.id],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      ["SO-C-" + key, quote, key, snapshot],
    )
  ).rows[0].id;
  const line = (
    await db.query(
      "insert into erp_order_lines(order_id,position,product_id,quantity,delivered,snapshot) values($1,1,$2,10,$3,$4) returning id",
      [
        order,
        product,
        delivered,
        { product: "STEARATE 01", amount: "100", base_unit: "kg", code: key },
      ],
    )
  ).rows[0].id;
  await db.query(
    "insert into erp_fin_terms(order_id,mode,deposit_percent,billing_event,state,created_by) values($1,'credit',0,'dispatch','approved',$2)",
    [order, user.id],
  );
  const movement = (
    await db.query(
      "insert into erp_movements(number,kind,state,date,from_location,lines,order_id,created_by) values($1,'delivery','posted',erp_today(),$2,$3,$4,$5) returning id",
      [
        "DO-C-" + key,
        location,
        JSON.stringify([
          {
            order_line_id: line,
            lot_id: lot,
            product_id: product,
            base_quantity: String(delivered),
          },
        ]),
        order,
        user.id,
      ],
    )
  ).rows[0].id;
  return {
    ...user,
    key,
    today,
    customer,
    unit,
    product,
    location,
    lot,
    quote,
    order,
    line,
    movement,
  };
}
tx(
  "SO closure requires approval, detects stale review, releases reservations and keeps actual deliveries billable",
  async () => {
    const f = await fixture();
    const reservation = (
      await db.query(
        "insert into erp_reservations(order_line_id,lot_id,location_id,quantity,remaining) values($1,$2,$3,2,2) returning id",
        [f.line, f.lot, f.location],
      )
    ).rows[0].id;
    let c = await controls(f.token, "orders", f.order);
    assert.equal(c.closure_preview.financial.actual_value, "66.000000");
    assert.equal(c.closure_preview.lines[0].closing, "4.000000");
    const officer = await account("sales_officer");
    await fails(
      () =>
        rpc(officer.token, "close_order", {
          id: f.order,
          review_token: c.closure_preview.review_token,
          reason: "Customer cancelled remainder",
        }),
      /permission|denied/i,
    );
    await db.query("update erp_reservations set remaining=1 where id=$1", [
      reservation,
    ]);
    await fails(
      () =>
        rpc(f.token, "close_order", {
          id: f.order,
          review_token: c.closure_preview.review_token,
          reason: "Customer cancelled remainder",
        }),
      /changed/,
    );
    const draft = (
      await db.query(
        "insert into erp_movements(number,kind,date,lines,order_id,created_by) values($1,'delivery',erp_today(),'[]',$2,$3) returning id",
        ["DRAFT-" + f.key, f.order, f.id],
      )
    ).rows[0].id;
    c = await controls(f.token, "orders", f.order);
    assert.equal(c.closure_preview.can_close, false);
    assert.match(c.closure_preview.blockers.join(" "), /draft deliveries/);
    await rpc(f.token, "cancel_move", {
      id: draft,
      reason: "Do not ship remaining quantity",
    });
    c = await controls(f.token, "orders", f.order);
    await rpc(f.token, "close_order", {
      id: f.order,
      review_token: c.closure_preview.review_token,
      reason: "Customer cancelled remainder",
    });
    assert.equal(
      (await db.query("select state from erp_orders where id=$1", [f.order]))
        .rows[0].state,
      "closed",
    );
    assert.equal(
      Number(
        (
          await db.query("select quantity from erp_order_lines where id=$1", [
            f.line,
          ])
        ).rows[0].quantity,
      ),
      10,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select quantity from erp_balances where lot_id=$1 and location_id=$2",
            [f.lot, f.location],
          )
        ).rows[0].quantity,
      ),
      20,
    );
    assert.equal(
      (
        await db.query("select state from erp_reservations where id=$1", [
          reservation,
        ])
      ).rows[0].state,
      "cancelled",
    );
    c = await controls(f.token, "orders", f.order);
    assert.equal(c.closure.lines[0].closing, "4.000000");
    assert.ok(
      c.history.some(
        (e: { action: string; actor: string }) =>
          e.action === "close_order" && e.actor === "Controls reviewer",
      ),
    );
    const warehouse = await account("warehouse_operator");
    const fulfillment = await controls(warehouse.token, "fulfillment", f.order);
    assert.equal(fulfillment.closure.financial_snapshot, undefined);
    for (const event of fulfillment.history) {
      assert.equal(event.reason, undefined);
      for (const change of event.changes) {
        assert.equal(change.after.billing_event, undefined);
        assert.equal(change.after.price, undefined);
        assert.equal(change.after.amount, undefined);
      }
    }
    await fails(
      () =>
        rpc(f.token, "reverse_move", {
          id: f.movement,
          reason: "Would invalidate closure",
        }),
      /closed/,
    );
    await fails(
      () =>
        rpc(f.token, "fin_create_document", {
          request_key: randomUUID(),
          kind: "payment_request",
          order_id: f.order,
          date: f.today,
          due_date: f.today,
          amount: "1",
          lines: [],
        }),
      /closed/,
    );
    const bill = await rpc(f.token, "fin_create_document", {
      request_key: randomUUID(),
      kind: "invoice",
      order_id: f.order,
      delivery_id: f.movement,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: f.line, quantity: "6" }],
    });
    assert.equal(
      Number(
        (
          await db.query("select amount from erp_fin_documents where id=$1", [
            bill.id,
          ])
        ).rows[0].amount,
      ),
      66,
    );
    await rpc(f.token, "fin_issue_document", {
      id: bill.id,
      version: 1,
      reason: "Invoice completed shipment",
    });
    await fails(
      () =>
        rpc(f.token, "fin_create_document", {
          request_key: randomUUID(),
          kind: "invoice",
          order_id: f.order,
          delivery_id: f.movement,
          date: f.today,
          due_date: f.today,
          lines: [{ line_id: f.line, quantity: "1" }],
        }),
      /quantity/,
    );
    await fails(
      () =>
        db.query(
          "delete from erp_document_events where entity='order' and source_id=$1",
          [f.order],
        ),
      /immutable/,
    );
    await fails(
      () =>
        db.query(
          "update erp_order_closures set reason='Rewrite history' where source_id=$1",
          [f.order],
        ),
      /immutable/,
    );
  },
);
tx(
  "Issued advance cancellation preserves funds and blocks cancellation until allocations are reversed",
  async () => {
    const f = await fixture(0);
    const d = await rpc(f.token, "fin_create_document", {
      request_key: randomUUID(),
      kind: "payment_request",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      amount: "110",
      lines: [],
    });
    await rpc(f.token, "fin_issue_document", {
      id: d.id,
      version: 1,
      reason: "Advance request approved",
    });
    const p = await rpc(f.token, "fin_record_payment", {
      request_key: randomUUID(),
      direction: "receipt",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "10",
      date: f.today,
      bank_account: "Controls bank",
      bank_reference: f.key,
      evidence: "Actual bank statement",
      notes: "",
    });
    await rpc(f.token, "fin_verify_payment", {
      id: p.id,
      version: 1,
      reason: "Verified actual bank funds",
    });
    const a = await rpc(f.token, "fin_allocate", {
      request_key: randomUUID(),
      payment_id: p.id,
      document_id: d.id,
      amount: "10",
      reason: "Allocate advance funds",
    });
    let c = await controls(f.token, "orders", f.order);
    assert.equal(c.closure_preview.can_close, false);
    await fails(
      () =>
        rpc(f.token, "fin_cancel_request", {
          id: d.id,
          version: 2,
          reason: "Customer cancelled order",
        }),
      /allocations/,
    );
    const allocation = (
      await db.query("select id from erp_fin_allocations where payment_id=$1", [
        p.id,
      ])
    ).rows[0].id;
    await rpc(f.token, "fin_reverse_allocation", {
      id: allocation,
      reason: "Return funds to available balance",
    });
    await rpc(f.token, "fin_cancel_request", {
      id: d.id,
      version: 2,
      reason: "Customer cancelled order",
    });
    assert.equal(
      (await db.query("select state from erp_fin_payments where id=$1", [p.id]))
        .rows[0].state,
      "verified",
    );
    assert.equal(
      (
        await db.query("select state from erp_fin_documents where id=$1", [
          d.id,
        ])
      ).rows[0].state,
      "void",
    );
    assert.equal(
      Number(
        (
          await db.query("select amount from erp_fin_payments where id=$1", [
            p.id,
          ])
        ).rows[0].amount,
      ),
      10,
    );
    c = await controls(f.token, "orders", f.order);
    assert.equal(c.closure_preview.can_close, true);
    await rpc(f.token, "close_order", {
      id: f.order,
      reason: "No further goods required",
      review_token: c.closure_preview.review_token,
    });
    void a;
  },
);
tx(
  "PO matching requires current acknowledged variance review; closed receipts remain billable and cannot reopen",
  async () => {
    const f = await fixture();
    const supplier = (
      await db.query(
        "insert into erp_suppliers(name) values('Controls supplier') returning id",
      )
    ).rows[0].id;
    const material = (
      await db.query(
        "insert into erp_materials(code,name,unit_id) values($1,'STEARIC ACID',$2) returning id",
        [f.key, f.unit],
      )
    ).rows[0].id;
    const po = (
      await db.query(
        "insert into erp_purchase_orders(number,supplier_id,date,expected_date,currency,state,created_by) values($1,$2,erp_today(),erp_today(),'IDR','confirmed',$3) returning id",
        ["PO-C-" + f.key, supplier, f.id],
      )
    ).rows[0].id;
    const line = (
      await db.query(
        'insert into erp_purchase_lines(order_id,position,material_id,quantity,price,snapshot) values($1,1,$2,10,10,\'{"name":"STEARIC ACID","unit":"kg"}\') returning id',
        [po, material],
      )
    ).rows[0].id;
    await rpc(f.token, "receive_purchase", {
      request_key: randomUUID(),
      id: po,
      version: 1,
      date: f.today,
      location_id: f.location,
      reason: "Actual receipt",
      lines: [
        { line_id: line, quantity: "8", lot_number: f.key, expiry_date: "" },
      ],
    });
    await fails(
      () =>
        rpc(f.token, "cancel_purchase", {
          id: po,
          version: 2,
          reason: "Supplier will not send remainder",
        }),
      /Close remaining/,
    );
    const bill = await rpc(f.token, "fin_create_document", {
      request_key: randomUUID(),
      kind: "supplier_bill",
      purchase_id: po,
      date: f.today,
      due_date: f.today,
      external_reference: f.key,
      lines: [{ line_id: line, quantity: "4", price: "11" }],
    });
    let c = await controls(f.token, "fin_documents", bill.id);
    assert.equal(c.matching.lines[0].price_variance, "4.000000");
    assert.equal(c.matching.quantity_valid, true);
    await fails(
      () =>
        rpc(f.token, "fin_issue_document", {
          id: bill.id,
          version: 1,
          reason: "Would skip explicit review",
        }),
      /acknowledge/,
    );
    await fails(
      () =>
        rpc(f.token, "fin_review_variance", {
          id: bill.id,
          version: 1,
          reason: "Price difference accepted",
          acknowledged: false,
          review_token: c.matching.review_token,
        }),
      /Acknowledge/,
    );
    const officer = await account("finance_officer");
    await fails(
      () =>
        rpc(officer.token, "fin_review_variance", {
          id: bill.id,
          version: 1,
          reason: "Price difference accepted",
          acknowledged: true,
          review_token: c.matching.review_token,
        }),
      /permission|denied/i,
    );
    await db.query(
      "update erp_purchase_orders set version=version+1 where id=$1",
      [po],
    );
    await fails(
      () =>
        rpc(f.token, "fin_review_variance", {
          id: bill.id,
          version: 1,
          reason: "Price difference accepted",
          acknowledged: true,
          review_token: c.matching.review_token,
        }),
      /changed/,
    );
    c = await controls(f.token, "fin_documents", bill.id);
    await rpc(f.token, "fin_review_variance", {
      id: bill.id,
      version: 1,
      reason: "Supplier price agreement verified",
      acknowledged: true,
      review_token: c.matching.review_token,
    });
    await rpc(f.token, "fin_issue_document", {
      id: bill.id,
      version: 1,
      reason: "Variance review approved",
    });
    c = await controls(f.token, "purchases", po);
    await rpc(f.token, "close_purchase", {
      id: po,
      version: 3,
      review_token: c.closure_preview.review_token,
      reason: "Supplier cannot supply remainder",
    });
    const closed = (
      await db.query(
        "select p.state,l.quantity,l.received from erp_purchase_orders p join erp_purchase_lines l on l.order_id=p.id where p.id=$1",
        [po],
      )
    ).rows[0];
    assert.equal(closed.state, "closed");
    assert.equal(Number(closed.quantity), 10);
    assert.equal(Number(closed.received), 8);
    await fails(
      () =>
        rpc(f.token, "receive_purchase", {
          request_key: randomUUID(),
          id: po,
          version: 4,
          date: f.today,
          location_id: f.location,
          reason: "Cannot reopen",
          lines: [
            {
              line_id: line,
              quantity: "1",
              lot_number: "extra",
              expiry_date: "",
            },
          ],
        }),
      /not open/,
    );
    const remainingBill = await rpc(f.token, "fin_create_document", {
      request_key: randomUUID(),
      kind: "supplier_bill",
      purchase_id: po,
      date: f.today,
      due_date: f.today,
      external_reference: "remaining-" + f.key,
      lines: [{ line_id: line, quantity: "4", price: "10" }],
    });
    await rpc(f.token, "fin_issue_document", {
      id: remainingBill.id,
      version: 1,
      reason: "Bill actual receipts after closure",
    });
    await fails(
      () =>
        rpc(f.token, "fin_create_document", {
          request_key: randomUUID(),
          kind: "supplier_bill",
          purchase_id: po,
          date: f.today,
          due_date: f.today,
          external_reference: "extra-" + f.key,
          lines: [{ line_id: line, quantity: "1", price: "11" }],
        }),
      /exceeds/,
    );
    const receipt = (
      await db.query(
        "select id from erp_material_transactions where order_id=$1 and kind='receipt'",
        [po],
      )
    ).rows[0].id;
    await fails(
      () =>
        rpc(f.token, "reverse_material_transaction", {
          id: receipt,
          reason: "Cannot invalidate closure",
        }),
      /closed/,
    );
    assert.equal(
      (await controls(f.token, "fin_documents", bill.id)).variance_review
        .current,
      true,
    );
  },
);
tx(
  "Control helpers are private and migrations do not grow repeated financial patches",
  async () => {
    const body = async () =>
      (
        await db.query(
          "select pg_get_functiondef('erp_fin_dispatch_status(uuid)'::regprocedure) d",
        )
      ).rows[0].d;
    const before = await body();
    await db.query(
      await readFile(
        new URL(
          "../src/lib/db/migrations/015_transaction_controls.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(await body(), before);
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'erp_controls(text,text,text,integer)','EXECUTE') b",
            [role],
          )
        ).rows[0].b,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'erp_close_preview(text,uuid)','EXECUTE') b",
            [role],
          )
        ).rows[0].b,
        false,
      );
    }
  },
);
