import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
before(async () => {
  await db.connect();
  for (const file of [
    "010_operational_exceptions",
    "011_operational_finance",
    "012_workflow_integration",
    "013_controlled_corrections",
  ]) {
    const sql = await readFile(
      new URL("../src/lib/db/migrations/" + file + ".sql", import.meta.url),
      "utf8",
    );
    await db.query(sql);
    await db.query(sql);
  }
});
after(() => db.end());
async function account(role = "administrator inbionusa") {
  const id = (
    await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'test-only',$2,'Workflow fixture') returning id",
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
async function mutate(
  token: string,
  action: string,
  payload: Record<string, unknown>,
) {
  return (
    await db.query("select erp_mutate($1,$2,$3) r", [token, action, payload])
  ).rows[0].r;
}
async function read(token: string, entity: string, id?: string) {
  return (
    await db.query("select erp_read($1,$2,'','',1,$3) r", [
      token,
      entity,
      id ?? null,
    ])
  ).rows[0].r;
}
async function fails(fn: () => Promise<unknown>, pattern?: RegExp) {
  await db.query("savepoint expected_failure");
  try {
    await assert.rejects(fn, pattern ?? (() => true));
  } finally {
    await db.query("rollback to savepoint expected_failure");
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
async function fixture() {
  const user = await account();
  await db.query(
    "update erp_modules set state='active' where key in ('finance','service','sales','warehouse','purchase')",
  );
  const today = (await db.query("select erp_today()::text d")).rows[0].d;
  const customer = (
    await db.query(
      "insert into erp_customers(name) values('Workflow customer') returning id",
    )
  ).rows[0].id;
  const root = randomUUID();
  const snapshot = {
    customer: { name: "Workflow customer" },
    currency: "IDR",
    tax_rate: "10",
    totals: { subtotal: "100", tax: "10", freight: "0", total: "110" },
    lines: [],
  };
  const quote = (
    await db.query(
      "insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]',$4,$5) returning id",
      ["Q-" + root, root, customer, snapshot.totals, user.id],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      ["SO-" + root, quote, root, snapshot],
    )
  ).rows[0].id;
  return { ...user, today, customer, order };
}
const key = () => ({ request_key: randomUUID() });
tx(
  "Finance opt-in, payment terms, maker-checker and idempotent billing",
  async () => {
    const f = await fixture();
    assert.equal(
      (await read(f.token, "dispatch_status", f.order)).rows[0].cleared,
      false,
    );
    await mutate(f.token, "fin_terms", {
      ...key(),
      order_id: f.order,
      mode: "prepaid",
      deposit_percent: "0",
      due_days: 30,
      billing_event: "order",
    });
    await mutate(f.token, "fin_approve_terms", {
      id: f.order,
      version: 1,
      reason: "Admin reviewed agreement",
    });
    const payload = {
      ...key(),
      kind: "payment_request",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      amount: "110",
      lines: [],
    };
    const doc = await mutate(f.token, "fin_create_document", payload);
    assert.deepEqual(
      await mutate(f.token, "fin_create_document", payload),
      doc,
    );
    await fails(
      () =>
        mutate(f.token, "fin_create_document", { ...payload, amount: "100" }),
      /identifier/,
    );
    await mutate(f.token, "fin_issue_document", {
      id: doc.id,
      version: 1,
      reason: "Reviewed commercial agreement",
    });
    const p = await mutate(f.token, "fin_record_payment", {
      ...key(),
      direction: "receipt",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "110",
      date: f.today,
      bank_account: "BCA",
      bank_reference: randomUUID(),
      evidence: "Bank statement confirmed",
    });
    await fails(
      () =>
        mutate(f.token, "fin_allocate", {
          ...key(),
          payment_id: p.id,
          document_id: doc.id,
          amount: "110",
          reason: "Allocate advance",
        }),
      /verified/,
    );
    await mutate(f.token, "fin_verify_payment", {
      id: p.id,
      version: 1,
      reason: "Actual funds checked",
    });
    await mutate(f.token, "fin_allocate", {
      ...key(),
      payment_id: p.id,
      document_id: doc.id,
      amount: "110",
      reason: "Allocate advance",
    });
    assert.equal(
      (await read(f.token, "dispatch_status", f.order)).rows[0].cleared,
      true,
    );
    assert.equal(
      (await read(f.token, "fin_documents", doc.id)).rows[0].outstanding,
      "0",
    );
    await fails(
      () =>
        mutate(f.token, "fin_allocate", {
          ...key(),
          payment_id: p.id,
          document_id: doc.id,
          amount: "1",
          reason: "Duplicate funds",
        }),
      /balance/,
    );
    for (const entity of [
      "fin_documents",
      "fin_payments",
      "fin_orders",
      "fin_purchases",
      "fin_credit_policies",
      "fin_aging",
      "ops_cases",
      "ops_receipts",
      "ops_material_receipts",
      "ops_policy",
      "ops_owners",
    ])
      assert.ok(Array.isArray((await read(f.token, entity)).rows), entity);
  },
);
tx(
  "Credit limit, policy concurrency, overdue holds and short-lived override",
  async () => {
    const f = await fixture();
    await mutate(f.token, "fin_terms", {
      ...key(),
      order_id: f.order,
      mode: "credit",
      deposit_percent: "0",
      due_days: 30,
      billing_event: "order",
    });
    await mutate(f.token, "fin_approve_terms", {
      id: f.order,
      version: 1,
      reason: "Approve agreed credit",
    });
    assert.equal(
      (await read(f.token, "dispatch_status", f.order)).rows[0].cleared,
      false,
    );
    await mutate(f.token, "fin_credit_policy", {
      customer_id: f.customer,
      currency: "IDR",
      credit_limit: "100",
      on_hold: false,
      hold_overdue: true,
      reason: "Initial credit review",
    });
    assert.equal(
      (await read(f.token, "dispatch_status", f.order)).rows[0].cleared,
      false,
    );
    await mutate(f.token, "fin_credit_policy", {
      customer_id: f.customer,
      currency: "IDR",
      version: 1,
      credit_limit: "200",
      on_hold: false,
      hold_overdue: true,
      reason: "Updated approved limit",
    });
    assert.equal(
      (await read(f.token, "dispatch_status", f.order)).rows[0].cleared,
      true,
    );
    await fails(
      () =>
        mutate(f.token, "fin_credit_policy", {
          customer_id: f.customer,
          currency: "IDR",
          version: 1,
          credit_limit: "999",
          on_hold: false,
          hold_overdue: true,
          reason: "Stale version",
        }),
      /changed/,
    );
    await mutate(f.token, "fin_dispatch_override", {
      ...key(),
      order_id: f.order,
      expires_on: f.today,
      reason: "Management approved exception",
    });
  },
);
async function product() {
  return (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,'INDOSTER 01','Chemical','kg','Halal','Bag') returning id",
      [randomUUID()],
    )
  ).rows[0].id;
}
async function orderLine(order: string) {
  return (
    await db.query(
      "insert into erp_order_lines(order_id,position,product_id,quantity,snapshot) values($1,1,$2,10,$3) returning id",
      [
        order,
        await product(),
        { product: "INDOSTER 01", amount: "100", base_unit: "kg", code: "01" },
      ],
    )
  ).rows[0].id;
}
async function approveTerms(
  f: Awaited<ReturnType<typeof fixture>>,
  billing = "order",
) {
  await mutate(f.token, "fin_terms", {
    ...key(),
    order_id: f.order,
    mode: "credit",
    deposit_percent: "0",
    due_days: 30,
    billing_event: billing,
  });
  await mutate(f.token, "fin_approve_terms", {
    id: f.order,
    version: 1,
    reason: "Agreed terms reviewed",
  });
}
async function issue(token: string, id: string) {
  await mutate(token, "fin_issue_document", {
    id,
    version: 1,
    reason: "Reviewed source and amount",
  });
}
tx(
  "Invoices derive agreed prices, reserve unbilled quantities and settle credit separately",
  async () => {
    const f = await fixture(),
      line = await orderLine(f.order);
    await approveTerms(f);
    const inv = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "invoice",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: line, quantity: "6" }],
    });
    assert.equal(
      (await read(f.token, "fin_documents", inv.id)).rows[0].amount,
      "66.000000",
    );
    await issue(f.token, inv.id);
    await fails(
      () =>
        mutate(f.token, "fin_create_document", {
          ...key(),
          kind: "invoice",
          order_id: f.order,
          date: f.today,
          due_date: f.today,
          lines: [{ line_id: line, quantity: "5" }],
        }),
      /unbilled/,
    );
    const credit = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "credit_note",
      related_id: inv.id,
      date: f.today,
      due_date: f.today,
      amount: "11",
      reason: "Customer shortage agreed",
    });
    await issue(f.token, credit.id);
    await mutate(f.token, "fin_apply_credit", {
      ...key(),
      credit_id: credit.id,
      invoice_id: inv.id,
      amount: "11",
      reason: "Apply shortage credit",
    });
    assert.equal(
      (await read(f.token, "fin_documents", inv.id)).rows[0].outstanding,
      "55.000000",
    );
    assert.equal(
      (await read(f.token, "fin_documents", credit.id)).rows[0].outstanding,
      "0",
    );
    await fails(() =>
      mutate(f.token, "fin_apply_credit", {
        ...key(),
        credit_id: credit.id,
        invoice_id: inv.id,
        amount: "1",
        reason: "Duplicate credit",
      }),
    );
    await mutate(f.token, "fin_collection", {
      ...key(),
      document_id: inv.id,
      kind: "promise",
      reason: "Customer promised payment",
      promised_date: f.today,
      promised_amount: "55",
    });
    await mutate(f.token, "fin_collection", {
      ...key(),
      document_id: inv.id,
      kind: "dispute",
      reason: "Customer checking quantity",
    });
    assert.equal(
      (await read(f.token, "fin_documents", inv.id)).rows[0].disputed,
      true,
    );
    await mutate(f.token, "fin_collection", {
      ...key(),
      document_id: inv.id,
      kind: "resolve_dispute",
      reason: "Evidence accepted by customer",
    });
    await fails(() =>
      mutate(f.token, "fin_void_document", {
        id: inv.id,
        version: 4,
        reason: "Delete historical invoice",
      }),
    );
  },
);
tx(
  "Officer cannot self-approve, wrong-party allocation and duplicate bank verification are blocked",
  async () => {
    const f = await fixture(),
      officer = await account("finance_officer");
    await approveTerms(f);
    const doc = await mutate(officer.token, "fin_create_document", {
      ...key(),
      kind: "payment_request",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      amount: "110",
    });
    await fails(() => issue(officer.token, doc.id));
    await issue(f.token, doc.id);
    const ref = randomUUID();
    const payload = {
      ...key(),
      direction: "receipt",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "110",
      date: f.today,
      bank_account: "BCA",
      bank_reference: ref,
      evidence: "Bank entry checked",
    };
    const p = await mutate(officer.token, "fin_record_payment", payload);
    await fails(() =>
      mutate(officer.token, "fin_verify_payment", {
        id: p.id,
        version: 1,
        reason: "Cannot verify own entry",
      }),
    );
    await mutate(f.token, "fin_verify_payment", {
      id: p.id,
      version: 1,
      reason: "Manager checked entry",
    });
    const p2 = await mutate(officer.token, "fin_record_payment", {
      ...payload,
      ...key(),
    });
    await fails(
      () =>
        mutate(f.token, "fin_verify_payment", {
          id: p2.id,
          version: 1,
          reason: "Duplicate bank reference",
        }),
      /duplicate key/,
    );
    const other = (
      await db.query(
        "insert into erp_customers(name) values('Other customer') returning id",
      )
    ).rows[0].id;
    const wrong = await mutate(f.token, "fin_record_payment", {
      ...payload,
      ...key(),
      party_id: other,
      bank_reference: randomUUID(),
    });
    await mutate(f.token, "fin_verify_payment", {
      id: wrong.id,
      version: 1,
      reason: "Other funds checked",
    });
    await fails(
      () =>
        mutate(f.token, "fin_allocate", {
          ...key(),
          payment_id: wrong.id,
          document_id: doc.id,
          amount: "10",
          reason: "Wrong customer",
        }),
      /same party/,
    );
    await db.query(
      "update erp_modules set state='read_only' where key='finance'",
    );
    await fails(() =>
      mutate(f.token, "fin_record_payment", { ...payload, ...key() }),
    );
    assert.ok((await read(f.token, "fin_documents")).rows.length);
    await db.query(
      "update erp_modules set state='disabled' where key='finance'",
    );
    await fails(() => read(f.token, "fin_documents"));
  },
);
tx(
  "Supplier bill matches received quantities and retains explicit price variance",
  async () => {
    const f = await fixture();
    const supplier = (
      await db.query(
        "insert into erp_suppliers(name) values('Workflow supplier') returning id",
      )
    ).rows[0].id;
    const unit = (await db.query("select id from erp_units limit 1")).rows[0]
      .id;
    const material = (
      await db.query(
        "insert into erp_materials(code,name,unit_id) values($1,'Stearic acid',$2) returning id",
        [randomUUID(), unit],
      )
    ).rows[0].id;
    const po = (
      await db.query(
        "insert into erp_purchase_orders(number,supplier_id,date,expected_date,currency,state,created_by) values($1,$2,erp_today(),erp_today(),'IDR','partial',$3) returning id",
        [randomUUID(), supplier, f.id],
      )
    ).rows[0].id;
    const line = (
      await db.query(
        "insert into erp_purchase_lines(order_id,position,material_id,quantity,price,received,snapshot) values($1,1,$2,10,10,4,$3) returning id",
        [po, material, { name: "Stearic acid", unit: "kg" }],
      )
    ).rows[0].id;
    const base = {
      ...key(),
      kind: "supplier_bill",
      purchase_id: po,
      date: f.today,
      due_date: f.today,
      external_reference: "SUP-001",
      lines: [{ line_id: line, quantity: "5", price: "10" }],
    };
    await fails(() => mutate(f.token, "fin_create_document", base), /received/);
    const bill = await mutate(f.token, "fin_create_document", {
      ...base,
      ...key(),
      lines: [{ line_id: line, quantity: "4", price: "11" }],
    });
    assert.equal(
      (await read(f.token, "fin_documents", bill.id)).rows[0].match_state,
      "variance",
    );
    await issue(f.token, bill.id);
    const advance = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "supplier_request",
      purchase_id: po,
      date: f.today,
      due_date: f.today,
      amount: "10",
    });
    await issue(f.token, advance.id);
    const credit = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "supplier_credit",
      related_id: bill.id,
      date: f.today,
      due_date: f.today,
      amount: "4",
      reason: "Price discrepancy agreed",
    });
    await issue(f.token, credit.id);
    await mutate(f.token, "fin_apply_credit", {
      ...key(),
      credit_id: credit.id,
      invoice_id: bill.id,
      amount: "4",
      reason: "Apply supplier correction",
    });
    assert.equal(
      (await read(f.token, "fin_documents", bill.id)).rows[0].outstanding,
      "40.000000",
    );
  },
);
async function approvedCase(
  f: Awaited<ReturnType<typeof fixture>>,
  kind = "change_request",
  sourceType = "order",
  source = f.order,
  resolution = "correction",
  extra: Record<string, unknown> = {},
) {
  const c = await mutate(f.token, "ops_create_case", {
    ...key(),
    kind,
    source_type: sourceType,
    source_id: source,
    title: "Review operational exception",
    description: "Recorded supporting evidence",
    evidence: [],
    ...extra,
  });
  await mutate(f.token, "ops_case_transition", {
    id: c.id,
    version: 1,
    state: "awaiting_approval",
    reason: "Ready for review",
  });
  await mutate(f.token, "ops_case_transition", {
    id: c.id,
    version: 2,
    state: "approved",
    resolution,
    cost_payer: "company",
    reason: "Evidence reviewed and approved",
  });
  return c;
}
tx(
  "Case source validation, approvals, audited SO amendments and stale updates",
  async () => {
    const f = await fixture(),
      line = await orderLine(f.order);
    await fails(() =>
      mutate(f.token, "ops_create_case", {
        ...key(),
        kind: "supplier_return",
        source_type: "order",
        source_id: f.order,
        title: "Wrong source",
        evidence: [],
      }),
    );
    const c = await approvedCase(f);
    await mutate(f.token, "ops_amend_order", {
      ...key(),
      id: c.id,
      version: 3,
      lines: [{ line_id: line, quantity: "8" }],
      reason: "Customer reduced remaining order",
    });
    assert.equal(
      (
        await db.query(
          "select quantity::text from erp_order_lines where id=$1",
          [line],
        )
      ).rows[0].quantity,
      "8.000000",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_amendments where source_id=$1",
          [f.order],
        )
      ).rows[0].n,
      1,
    );
    await fails(() =>
      mutate(f.token, "ops_amend_order", {
        ...key(),
        id: c.id,
        version: 3,
        lines: [{ line_id: line, quantity: "7" }],
        reason: "Stale amendment",
      }),
    );
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 4,
      state: "in_progress",
      reason: "Amendment applied",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 5,
      state: "resolved",
      reason: "Customer approved revised quantities",
      actual_cost: "0",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 6,
      state: "closed",
      reason: "All evidence retained",
    });
    const detail = (await read(f.token, "ops_cases", c.id)).rows[0];
    assert.equal(detail.state, "closed");
    assert.ok(detail.events.length >= 6);
    assert.ok(!("source_snapshot" in detail));
  },
);
tx(
  "Session RPC privacy and new roles cannot call historical helpers or read disabled modules",
  async () => {
    const f = await fixture();
    const viewer = await account("viewer");
    await fails(() => read(viewer.token, "fin_documents"));
    await fails(() => read(viewer.token, "ops_cases"));
    const rows = (
      await db.query(
        "select p.oid::regprocedure::text signature,has_function_privilege('service_role',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'erp_fin_%' or p.proname like 'erp_ops_%')",
      )
    ).rows;
    assert.ok(rows.length >= 5);
    for (const row of rows) assert.equal(row.allowed, false, row.signature);
    for (const table of [
      "erp_fin_documents",
      "erp_fin_payments",
      "erp_cases",
      "erp_case_events",
      "erp_amendments",
    ])
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('service_role',$1,'SELECT') allowed",
            [table],
          )
        ).rows[0].allowed,
        false,
      );
    assert.ok((await read(f.token, "ops_policy")).rows.length);
  },
);
async function deliveryFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const line = await orderLine(f.order),
    p = (
      await db.query("select product_id from erp_order_lines where id=$1", [
        line,
      ])
    ).rows[0].product_id;
  const unit = (await db.query("select id from erp_units limit 1")).rows[0].id;
  await db.query(
    "insert into erp_product_units(product_id,unit_id,factor,is_base) values($1,$2,1,true)",
    [p, unit],
  );
  const lot = (
    await db.query(
      "insert into erp_lots(product_id,number,mfg_date,expiry_date,qc_status) values($1,$2,erp_today(),erp_today()+365,'released') returning id",
      [p, randomUUID()],
    )
  ).rows[0].id;
  const location = (await db.query("select id from erp_locations limit 1"))
    .rows[0].id;
  const move = (
    await db.query(
      "insert into erp_movements(number,kind,state,date,order_id,lines,created_by,from_location) values($1,'delivery','posted',erp_today(),$2,$3,$4,$5) returning id",
      [
        randomUUID(),
        f.order,
        JSON.stringify([
          { order_line_id: line, lot_id: lot, base_quantity: "10" },
        ]),
        f.id,
        location,
      ],
    )
  ).rows[0].id;
  await db.query("update erp_order_lines set delivered=10 where id=$1", [line]);
  return { line, lot, move, location };
}
tx(
  "Receipt evidence validates every line and blocks billing before POD",
  async () => {
    const f = await fixture(),
      d = await deliveryFixture(f);
    await approveTerms(f, "receipt");
    const invoice = {
      ...key(),
      kind: "invoice",
      order_id: f.order,
      delivery_id: d.move,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: d.line, quantity: "4" }],
    };
    await fails(
      () => mutate(f.token, "fin_create_document", invoice),
      /receipt/,
    );
    const payload = {
      ...key(),
      delivery_id: d.move,
      recipient: "Customer receiving",
      received_date: f.today,
      status: "received",
      lines: [
        { order_line_id: d.line, lot_id: d.lot, accepted: "8", rejected: "2" },
      ],
      evidence: "Signed POD scan",
      notes: "",
    };
    await fails(() => mutate(f.token, "ops_delivery_receipt", payload));
    await mutate(f.token, "ops_delivery_receipt", {
      ...payload,
      ...key(),
      status: "partial",
    });
    const first = await mutate(f.token, "fin_create_document", {
      ...invoice,
      ...key(),
    });
    await issue(f.token, first.id);
    const second = await mutate(f.token, "fin_create_document", {
      ...invoice,
      ...key(),
      lines: [{ line_id: d.line, quantity: "6" }],
    });
    await issue(f.token, second.id);
    await fails(
      () =>
        mutate(f.token, "fin_create_document", {
          ...invoice,
          ...key(),
          lines: [{ line_id: d.line, quantity: "1" }],
        }),
      /unbilled/,
    );
    await fails(
      () =>
        mutate(f.token, "reverse_move", {
          id: d.move,
          reason: "Undo delivered goods",
        }),
      /receipt history/,
    );
  },
);
tx(
  "Claim quantity cap, customer-return request and physical completion remain separate",
  async () => {
    const f = await fixture(),
      d = await deliveryFixture(f);
    const c = await approvedCase(
      f,
      "customer_claim",
      "delivery",
      d.move,
      "return",
      { quantity: "4", lot_id: d.lot },
    );
    await mutate(f.token, "ops_customer_return", {
      ...key(),
      id: c.id,
      version: 3,
      location_id: d.location,
      reason: "Receive returned shortage goods",
    });
    const r = (
      await db.query(
        "select reference from erp_case_executions where case_id=$1 and kind='retur_customer'",
        [c.id],
      )
    ).rows[0].reference;
    assert.ok(r);
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 4,
      state: "in_progress",
      reason: "Return requested",
    });
    await fails(
      () =>
        mutate(f.token, "ops_case_transition", {
          id: c.id,
          version: 5,
          state: "resolved",
          reason: "Goods not yet received",
        }),
      /physical/,
    );
    await mutate(f.token, "receive_return", {
      id: r,
      reason: "Warehouse checked returned goods",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 5,
      state: "resolved",
      reason: "Returned goods received into quarantine",
      actual_cost: "0",
    });
    const duplicate = await mutate(f.token, "ops_create_case", {
      ...key(),
      kind: "customer_claim",
      source_type: "delivery",
      source_id: d.move,
      lot_id: d.lot,
      quantity: "7",
      title: "Excess duplicate claim",
      description: "",
      evidence: [],
    });
    await mutate(f.token, "ops_case_transition", {
      id: duplicate.id,
      version: 1,
      state: "awaiting_approval",
      reason: "Ready to review",
    });
    await fails(
      () =>
        mutate(f.token, "ops_case_transition", {
          id: duplicate.id,
          version: 2,
          state: "approved",
          resolution: "replacement",
          reason: "Duplicate shipment claim",
        }),
      /exceed/,
    );
  },
);
tx(
  "Quality withdrawal retains signed snapshots and allows a linked replacement COA after retest",
  async () => {
    const f = await fixture();
    await db.query("update erp_modules set state='active' where key='quality'");
    await db.query(
      "update erp_modules set state='disabled' where key='production'",
    );
    async function qc(action: string, payload: unknown) {
      return (
        await db.query("select qc_mutate($1,$2,$3) r", [
          f.token,
          action,
          payload,
        ])
      ).rows[0].r;
    }
    const p = await product();
    const spec = (
      await db.query(
        "insert into spesifikasi(id_produk,parameter_uji,tipe_batas,nilai_min,nilai_maks,satuan,keterangan,urutan) values($1,'pH','RANGE','6','8','','',0) returning id",
        [p],
      )
    ).rows[0].id;
    const lotNumber = randomUUID(),
      input = {
        id_produk: p,
        no_lot: lotNumber,
        tgl_sampling: f.today,
        tgl_uji: f.today,
        inspector: "QC fixture",
        catatan: "",
        failure_reason: "",
        hasil_detail: [{ spec_id: spec, p: "pH", val: "7", st: "PASS" }],
      };
    const first = await qc("create_uji", input);
    const expiry = (
      await db.query("select (erp_today()+interval '1 year')::date::text d")
    ).rows[0].d;
    const certificate = {
      id_hasil: first.id,
      no_coa: "",
      tanggal_rilis: f.today,
      tanggal_expired: expiry,
      mfg_date: f.today,
      tanda_tangan: "QC fixture",
      language: "en",
    };
    const co = await qc("issue_coa", certificate);
    const lot = (
      await db.query("select id from erp_lots where inspection_id=$1", [
        first.id,
      ])
    ).rows[0].id;
    const c = await approvedCase(f, "quality_retest", "lot", lot, "correction");
    await mutate(f.token, "ops_withdraw_coa", {
      id: c.id,
      version: 3,
      coa_id: co.id,
      reason: "Quality deviation requires retest",
    });
    assert.equal(
      (await db.query("select withdrawn from coa where id=$1", [co.id])).rows[0]
        .withdrawn,
      true,
    );
    await mutate(f.token, "ops_retest", {
      id: c.id,
      version: 4,
      reason: "Authorized fresh sample retest",
    });
    const second = await qc("create_uji", input);
    assert.notEqual(first.id, second.id);
    const replacement = await qc("issue_coa", {
      ...certificate,
      id_hasil: second.id,
    });
    assert.notEqual(replacement.id, co.id);
    assert.equal(
      (
        await db.query(
          "select new_inspection from erp_retests where case_id=$1",
          [c.id],
        )
      ).rows[0].new_inspection,
      second.id,
    );
    assert.equal(
      (
        await db.query("select count(*)::int n from coa where id_produk=$1", [
          p,
        ])
      ).rows[0].n,
      2,
    );
  },
);
tx(
  "Advance allocations move partially without creating new funds and can be corrected",
  async () => {
    const f = await fixture(),
      line = await orderLine(f.order);
    await approveTerms(f);
    const req = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "payment_request",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      amount: "110",
    });
    await issue(f.token, req.id);
    const inv = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "invoice",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: line, quantity: "10" }],
    });
    await issue(f.token, inv.id);
    const pay = await mutate(f.token, "fin_record_payment", {
      ...key(),
      direction: "receipt",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "110",
      date: f.today,
      bank_account: "Fixture bank",
      bank_reference: randomUUID(),
      evidence: "Funds checked",
    });
    await mutate(f.token, "fin_verify_payment", {
      id: pay.id,
      version: 1,
      reason: "Funds matched statement",
    });
    await mutate(f.token, "fin_allocate", {
      ...key(),
      payment_id: pay.id,
      document_id: req.id,
      amount: "110",
      reason: "Full advance allocation",
    });
    const allocation = (await read(f.token, "fin_payments", pay.id)).rows[0]
      .allocations[0];
    await mutate(f.token, "fin_move_allocation", {
      ...key(),
      id: allocation.id,
      document_id: inv.id,
      amount: "55",
      reason: "Half advance applied to final invoice",
    });
    assert.equal(
      (await read(f.token, "fin_documents", req.id)).rows[0].outstanding,
      "55.000000",
    );
    assert.equal(
      (await read(f.token, "fin_documents", inv.id)).rows[0].outstanding,
      "55.000000",
    );
    const detail = (await read(f.token, "fin_payments", pay.id)).rows[0];
    assert.equal(detail.available, "0.000000");
    assert.equal(
      detail.allocations.filter((a: { state: string }) => a.state === "active")
        .length,
      2,
    );
    await fails(
      () =>
        mutate(f.token, "fin_void_payment", {
          id: pay.id,
          version: 2,
          reason: "Cannot erase allocated funds",
        }),
      /allocations/,
    );
  },
);
tx(
  "Financial claim cannot settle below approval; reversing a refund reopens its case",
  async () => {
    const f = await fixture(),
      line = await orderLine(f.order);
    await approveTerms(f);
    const inv = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "invoice",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: line, quantity: "10" }],
    });
    await issue(f.token, inv.id);
    const c = await mutate(f.token, "ops_create_case", {
      ...key(),
      kind: "customer_claim",
      source_type: "order",
      source_id: f.order,
      title: "Agreed financial refund",
      description: "",
      evidence: [],
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 1,
      state: "awaiting_approval",
      reason: "Evidence ready",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 2,
      state: "approved",
      resolution: "refund",
      settlement_amount: "11",
      currency: "IDR",
      cost_payer: "company",
      reason: "Refund approved",
    });
    const credit = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "credit_note",
      related_id: inv.id,
      case_id: c.id,
      date: f.today,
      due_date: f.today,
      amount: "11",
      reason: "Refund authorized",
    });
    await issue(f.token, credit.id);
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 3,
      state: "in_progress",
      reason: "Refund processing",
    });
    await fails(
      () =>
        mutate(f.token, "ops_case_transition", {
          id: c.id,
          version: 4,
          state: "resolved",
          reason: "Credit issued but no funds returned",
        }),
      /settlement/,
    );
    const refund = await mutate(f.token, "fin_record_payment", {
      ...key(),
      direction: "refund",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "11",
      date: f.today,
      bank_account: "Fixture bank",
      bank_reference: randomUUID(),
      evidence: "Refund statement",
    });
    await mutate(f.token, "fin_verify_payment", {
      id: refund.id,
      version: 1,
      reason: "Refund transfer confirmed",
    });
    await mutate(f.token, "fin_allocate", {
      ...key(),
      payment_id: refund.id,
      document_id: credit.id,
      amount: "11",
      reason: "Refund matched to claim credit",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 4,
      state: "resolved",
      reason: "Verified full refund completed",
      actual_cost: "0",
    });
    const allocation = (await read(f.token, "fin_payments", refund.id)).rows[0]
      .allocations[0];
    await mutate(f.token, "fin_reverse_allocation", {
      id: allocation.id,
      reason: "Bank refund reference was incorrect",
    });
    assert.equal(
      (await read(f.token, "ops_cases", c.id)).rows[0].state,
      "under_review",
    );
    const search = (
      await db.query("select qc_global_search($1,$2) r", [f.token, credit.id])
    ).rows[0].r;
    assert.ok(Array.isArray(search));
    const hits = (
      await db.query("select qc_global_search($1,$2) r", [
        f.token,
        "Agreed financial refund",
      ])
    ).rows[0].r;
    assert.ok(hits.some((h: { id: string }) => h.id === c.id));
  },
);
tx(
  "Posting a delivery enforces Finance in the database even for an administrator",
  async () => {
    const f = await fixture(),
      location = (await db.query("select id from erp_locations limit 1"))
        .rows[0].id;
    const move = (
      await db.query(
        "insert into erp_movements(number,kind,date,from_location,order_id,lines,created_by) values($1,'delivery',erp_today(),$2,$3,'[]',$4) returning id",
        [randomUUID(), location, f.order, f.id],
      )
    ).rows[0].id;
    await fails(
      () => mutate(f.token, "post_move", { id: move }),
      /approve.*terms/,
    );
    await mutate(f.token, "fin_terms", {
      ...key(),
      order_id: f.order,
      mode: "prepaid",
      deposit_percent: "0",
      due_days: 30,
      billing_event: "order",
    });
    await mutate(f.token, "fin_approve_terms", {
      id: f.order,
      version: 1,
      reason: "Prepaid contract approved",
    });
    await fails(() => mutate(f.token, "post_move", { id: move }), /payments/);
    await db.query(
      "update erp_modules set state='read_only' where key='finance'",
    );
    await fails(() => mutate(f.token, "post_move", { id: move }), /payments/);
    assert.equal(
      (await db.query("select state from erp_movements where id=$1", [move]))
        .rows[0].state,
      "draft",
    );
  },
);
tx(
  "Held raw material is blocked for consumption and can be returned with approved supplier evidence",
  async () => {
    const f = await fixture();
    const supplier = (
      await db.query(
        "insert into erp_suppliers(name) values('Return supplier') returning id",
      )
    ).rows[0].id;
    const unit = (await db.query("select id from erp_units limit 1")).rows[0]
        .id,
      location = (await db.query("select id from erp_locations limit 1"))
        .rows[0].id;
    const material = (
      await db.query(
        "insert into erp_materials(code,name,unit_id) values($1,'Return stearate',$2) returning id",
        [randomUUID(), unit],
      )
    ).rows[0].id;
    const po = (
      await db.query(
        "insert into erp_purchase_orders(number,supplier_id,date,expected_date,currency,state,created_by) values($1,$2,erp_today(),erp_today(),'IDR','confirmed',$3) returning id",
        [randomUUID(), supplier, f.id],
      )
    ).rows[0].id;
    const line = (
      await db.query(
        "insert into erp_purchase_lines(order_id,position,material_id,quantity,price,snapshot) values($1,1,$2,10,10,$3) returning id",
        [po, material, { name: "Return stearate", unit: "kg" }],
      )
    ).rows[0].id;
    const receiptKey = key();
    await mutate(f.token, "receive_purchase", {
      ...receiptKey,
      id: po,
      version: 1,
      date: f.today,
      location_id: location,
      hold: true,
      reason: "Damaged packaging requires review",
      lines: [
        {
          line_id: line,
          quantity: "10",
          lot_number: randomUUID(),
          expiry_date: "",
        },
      ],
    });
    const receipt = (
      await db.query(
        "select id from erp_material_transactions where request_key=$1",
        [receiptKey.request_key],
      )
    ).rows[0];
    const lot = (
      await db.query(
        "select lot_id from erp_material_ledger where transaction_id=$1",
        [receipt.id],
      )
    ).rows[0].lot_id;
    assert.equal(
      (await db.query("select held from erp_material_lots where id=$1", [lot]))
        .rows[0].held,
      true,
    );
    await fails(
      () =>
        mutate(f.token, "issue_material", {
          ...key(),
          lot_id: lot,
          location_id: location,
          quantity: "1",
          date: f.today,
          reason: "Normal consumption",
        }),
      /Held/,
    );
    const c = await approvedCase(
      f,
      "supplier_return",
      "receipt",
      receipt.id,
      "return",
      { quantity: "4" },
    );
    await mutate(f.token, "ops_supplier_return", {
      ...key(),
      id: c.id,
      version: 3,
      lot_id: lot,
      location_id: location,
      quantity: "4",
      reason: "Supplier accepted damaged packaging",
    });
    assert.equal(
      (
        await db.query(
          "select quantity::text from erp_material_balances where lot_id=$1 and location_id=$2",
          [lot, location],
        )
      ).rows[0].quantity,
      "6.000000",
    );
    await fails(
      () =>
        mutate(f.token, "ops_supplier_return", {
          ...key(),
          id: c.id,
          version: 4,
          lot_id: lot,
          location_id: location,
          quantity: "1",
          reason: "Excess supplier return",
        }),
      /approved/,
    );
    const execution = (
      await db.query(
        "select material_transaction_id from erp_case_executions where case_id=$1",
        [c.id],
      )
    ).rows[0].material_transaction_id;
    await mutate(f.token, "reverse_material_transaction", {
      id: execution,
      reason: "Supplier returned the rejected shipment",
    });
    assert.equal(
      (await read(f.token, "ops_cases", c.id)).rows[0].state,
      "under_review",
    );
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 5,
      state: "awaiting_approval",
      reason: "Review replacement return arrangement",
    });
    await mutate(f.token, "ops_case_transition", {
      id: c.id,
      version: 6,
      state: "approved",
      resolution: "return",
      cost_payer: "company",
      reason: "Approve corrected return arrangement",
    });
    await mutate(f.token, "ops_supplier_return", {
      ...key(),
      id: c.id,
      version: 7,
      lot_id: lot,
      location_id: location,
      quantity: "4",
      reason: "Corrected supplier return confirmed",
    });
  },
);
tx(
  "Broken promises enter the inbox and disappear after the promised amount is settled",
  async () => {
    const f = await fixture(),
      line = await orderLine(f.order);
    await approveTerms(f);
    const inv = await mutate(f.token, "fin_create_document", {
      ...key(),
      kind: "invoice",
      order_id: f.order,
      date: f.today,
      due_date: f.today,
      lines: [{ line_id: line, quantity: "10" }],
    });
    await issue(f.token, inv.id);
    await mutate(f.token, "fin_collection", {
      ...key(),
      document_id: inv.id,
      kind: "promise",
      promised_date: f.today,
      promised_amount: "55",
      reason: "Customer committed partial payment",
    });
    await db.query(
      "create or replace function public.erp_today() returns date language sql stable as $$select (now() at time zone 'Asia/Jakarta')::date+2$$",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_inbox where id like 'fin-promise:%' and description=(select number from erp_fin_documents where id=$1)",
          [inv.id],
        )
      ).rows[0].n,
      1,
    );
    const pay = await mutate(f.token, "fin_record_payment", {
      ...key(),
      direction: "receipt",
      party_type: "customer",
      party_id: f.customer,
      currency: "IDR",
      amount: "55",
      date: f.today,
      bank_account: "Promise bank",
      bank_reference: randomUUID(),
      evidence: "Received promised funds",
    });
    await mutate(f.token, "fin_verify_payment", {
      id: pay.id,
      version: 1,
      reason: "Verified promised partial payment",
    });
    await mutate(f.token, "fin_allocate", {
      ...key(),
      payment_id: pay.id,
      document_id: inv.id,
      amount: "55",
      reason: "Apply promised partial payment",
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_inbox where id like 'fin-promise:%' and description=(select number from erp_fin_documents where id=$1)",
          [inv.id],
        )
      ).rows[0].n,
      0,
    );
  },
);
