import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
// This suite deliberately never accepts a remote database URL.
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
let token: string,
  viewer: string,
  actor: string,
  kg: string,
  location: string,
  today: string;
async function rpc(action: string, payload: unknown, session = token) {
  return (
    await db.query("select erp_mutate($1,$2,$3) r", [
      session,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].r;
}
async function read(
  entity: string,
  id?: string,
  session = token,
  state = "",
  q = "",
) {
  return (
    await db.query("select erp_read($1,$2,$3,$4,1,$5) r", [
      session,
      entity,
      q,
      state,
      id ?? null,
    ])
  ).rows[0].r;
}
async function fail(action: string, payload: unknown, session = token) {
  await db.query("savepoint rejected");
  try {
    await assert.rejects(() => rpc(action, payload, session));
  } finally {
    await db.query("rollback to rejected");
  }
}
function tx(name: string, run: () => Promise<void>) {
  test(name, async () => {
    await db.query("begin");
    try {
      await run();
    } finally {
      await db.query("rollback");
    }
  });
}
before(async () => {
  await db.connect();
  const sql = await readFile(
    new URL(
      "../src/lib/db/migrations/006_purchase_crm_documents.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
  for (const role of ["admin qc", "viewer"]) {
    const t = randomUUID();
    const u = (
      await db.query(
        "insert into users(username,password_hash,role,nama_lengkap) values($1,'fixture',$2,'Growth QA') returning id",
        [t, role],
      )
    ).rows[0].id;
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [u, t],
    );
    if (role === "viewer") viewer = t;
    else {
      token = t;
      actor = u;
    }
  }
  kg = (await db.query("select id from erp_units where code='kg'")).rows[0].id;
  location = (await db.query("select id from erp_locations where code='MAIN'"))
    .rows[0].id;
  today = (await db.query("select erp_today()::text t")).rows[0].t;
});
after(() => db.end());
async function fixture() {
  const supplier = (
    await rpc("save_supplier", {
      name: "Stearate supplier",
      contact: "Supplier",
      email: "",
      phone: "",
      address: "",
      tax_id: "",
      payment_terms: "30 days",
      active: true,
    })
  ).id;
  const material = (
    await rpc("save_material", {
      code: "RM-" + randomUUID(),
      name: "Stearic acid",
      unit_id: kg,
      minimum_stock: "10",
      active: true,
    })
  ).id;
  const order = (
    await rpc("save_purchase", {
      supplier_id: supplier,
      date: today,
      expected_date: today,
      currency: "IDR",
      terms: "Delivery to MAIN",
      lines: [{ material_id: material, quantity: "0.3", price: "12500.25" }],
    })
  ).id;
  return { supplier, material, order };
}
async function getPO(id: string) {
  return (await read("purchases", id)).rows[0];
}
async function confirm(id: string) {
  const p = await getPO(id);
  await rpc("confirm_purchase", { id, version: p.version });
  return getPO(id);
}
function receipt(
  p: { id: string; version: number; lines: { id: string }[] },
  quantity = "0.1",
) {
  return {
    id: p.id,
    version: p.version,
    request_key: randomUUID(),
    date: today,
    location_id: location,
    reason: "Supplier delivery",
    lines: [
      {
        line_id: p.lines[0].id,
        quantity,
        lot_number: "SUPPLIER-001",
        expiry_date: "",
      },
    ],
  };
}
async function opportunity() {
  return (
    await rpc("save_opportunity", {
      title: "Calcium stearate supply",
      company: "Customer A",
      contact: "Sales contact",
      email: "",
      phone: "",
      source: "Referral",
      notes: "Sample requested",
      owner_id: actor,
      expected_value: "12345678.12",
      currency: "IDR",
      probability: 25,
      expected_close: today,
    })
  ).id;
}
async function product() {
  return (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,'INDOSTER 01','Chemical','kg','Halal','Bag') returning id",
      [randomUUID()],
    )
  ).rows[0].id;
}
async function document(p: string) {
  return (
    await rpc("save_product_document", {
      product_id: p,
      kind: "SDS",
      language: "en",
      title: "Safety data sheet",
      file_url: "https://example.com/sds.pdf",
      effective_date: today,
      expiry_date: "",
      notes: "Approved source",
    })
  ).id;
}

tx(
  "purchase receiving is exact, partial, replay-safe and prevents over-receipt",
  async () => {
    const f = await fixture();
    let p = await confirm(f.order);
    const r = receipt(p);
    await rpc("receive_purchase", r);
    await rpc("receive_purchase", r);
    p = await getPO(f.order);
    assert.equal(p.state, "partial");
    assert.equal(p.lines[0].received, "0.100000");
    assert.equal(p.total, "3750.075000000000");
    await fail("receive_purchase", receipt(p, "0.3"));
    await rpc("receive_purchase", receipt(p, "0.2"));
    p = await getPO(f.order);
    assert.equal(p.state, "received");
    assert.equal(
      (await read("material_stock")).rows.find(
        (x: { material_id: string }) => x.material_id === f.material,
      ).quantity,
      "0.300000",
    );
  },
);
tx("receipt failure rolls back all stock and purchase lines", async () => {
  const f = await fixture(),
    p = await confirm(f.order),
    r = receipt(p);
  r.lines.push({ ...r.lines[0], quantity: "100" });
  await fail("receive_purchase", r);
  assert.equal((await getPO(f.order)).lines[0].received, "0.000000");
  assert.equal(
    (
      await db.query(
        "select count(*) n from erp_material_lots where material_id=$1",
        [f.material],
      )
    ).rows[0].n,
    "0",
  );
});
tx(
  "PO confirmation freezes supplier identity, rejects stale edits and material unit changes",
  async () => {
    const f = await fixture(),
      p = await confirm(f.order);
    await db.query(
      "update erp_suppliers set name='Renamed supplier' where id=$1",
      [f.supplier],
    );
    assert.equal((await getPO(f.order)).supplier, "Stearate supplier");
    await fail("save_purchase", {
      id: f.order,
      version: p.version,
      supplier_id: f.supplier,
      date: today,
      expected_date: today,
      currency: "IDR",
      lines: [],
    });
    const unit = (await db.query("select id from erp_units where code='bag'"))
      .rows[0].id;
    await fail("save_material", {
      id: f.material,
      version: 1,
      code: "CHANGED",
      name: "Stearic",
      unit_id: unit,
      minimum_stock: "0",
      active: true,
    });
  },
);
tx(
  "material issues prevent negative stock, replay twice only once and retain immutable trace",
  async () => {
    const f = await fixture();
    await rpc("receive_purchase", receipt(await confirm(f.order), "0.3"));
    const stock = (await read("material_stock")).rows.find(
      (x: { material_id: string }) => x.material_id === f.material,
    );
    const issue = {
      lot_id: stock.lot_id,
      location_id: location,
      quantity: "0.1",
      date: today,
      reason: "Production consumption",
      request_key: randomUUID(),
    };
    await fail("issue_material", {
      ...issue,
      date: "2020-01-01",
      request_key: randomUUID(),
    });
    const firstIssue = await rpc("issue_material", issue);
    assert.equal((await rpc("issue_material", issue)).id, firstIssue.id);
    assert.equal(
      (await read("material_stock", stock.id)).rows[0].quantity,
      "0.200000",
    );
    await fail("issue_material", {
      ...issue,
      quantity: "0.3",
      request_key: randomUUID(),
    });
    await db.query("savepoint immutable");
    await assert.rejects(() =>
      db.query("update erp_material_ledger set delta=1"),
    );
    await db.query("rollback to immutable");
  },
);
tx(
  "cancel outstanding keeps received material and rejects future receipts",
  async () => {
    const f = await fixture();
    await rpc("receive_purchase", receipt(await confirm(f.order)));
    const p = await getPO(f.order);
    await rpc("cancel_purchase", {
      id: p.id,
      version: p.version,
      reason: "Supplier cannot deliver balance",
    });
    assert.equal((await getPO(p.id)).state, "cancelled");
    await fail("receive_purchase", receipt(await getPO(p.id)));
    assert.equal((await getPO(p.id)).lines[0].received, "0.100000");
  },
);
tx(
  "module guards deny viewer RPCs, protect direct tables, and enforce read-only",
  async () => {
    for (const entity of [
      "purchases",
      "materials",
      "opportunities",
      "product_documents",
      "material_stock",
    ]) {
      await db.query("savepoint denied");
      await assert.rejects(() => read(entity, undefined, viewer));
      await db.query("rollback to denied");
    }
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('service_role','erp_purchase_orders','SELECT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role','erp_mutate_v5(text,text,jsonb)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    const f = await fixture();
    await rpc("set_module", { module: "purchase", state: "read_only" });
    assert.equal((await getPO(f.order)).id, f.order);
    await fail("confirm_purchase", { id: f.order, version: 1 });
  },
);
tx(
  "CRM conversion is replay-safe and won stage requires a linked customer",
  async () => {
    const id = await opportunity();
    let o = (await read("opportunities", id)).rows[0];
    await fail("stage_opportunity", {
      id,
      version: o.version,
      stage: "won",
      reason: "Agreed",
    });
    const c = await rpc("convert_opportunity", { id, version: o.version });
    assert.equal(
      (await rpc("convert_opportunity", { id, version: o.version })).id,
      c.id,
    );
    o = (await read("opportunities", id)).rows[0];
    await rpc("stage_opportunity", {
      id,
      version: o.version,
      stage: "won",
      reason: "Commercial agreement",
    });
    o = (await read("opportunities", id)).rows[0];
    assert.equal(o.stage, "won");
    assert.equal(o.expected_value, "12345678.120000");
    assert.equal(o.probability, 100);
  },
);
tx(
  "CRM follow-ups support overdue filters, assignment, completion and inbox",
  async () => {
    const id = await opportunity(),
      a = await rpc("save_crm_activity", {
        opportunity_id: id,
        title: "Discuss sample",
        kind: "call",
        due_date: "2020-01-01",
        assigned_to: actor,
        notes: "Ask for application requirements",
      });
    assert.equal(
      (await read("crm_activities", a.id, token, "overdue")).total,
      1,
    );
    assert.ok(
      (await read("inbox")).rows.some(
        (r: { id: string }) => r.id === "crm:" + a.id,
      ),
    );
    await rpc("complete_crm_activity", {
      id: a.id,
      state: "done",
      notes: "Sample sent",
    });
    assert.equal((await read("crm_activities", a.id)).rows[0].state, "done");
    await fail("complete_crm_activity", { id: a.id, state: "done", notes: "" });
  },
);
tx(
  "document publication supersedes old revisions and locks published metadata",
  async () => {
    const p = await product(),
      a = await document(p);
    let d = (await read("product_documents", a)).rows[0];
    await rpc("publish_product_document", { id: a, version: d.version });
    const b = await document(p);
    d = (await read("product_documents", b)).rows[0];
    assert.equal(d.revision, 2);
    await rpc("publish_product_document", { id: b, version: d.version });
    assert.equal(
      (await read("product_documents", a)).rows[0].state,
      "superseded",
    );
    assert.equal(
      (await read("product_documents", b)).rows[0].display_state,
      "valid",
    );
    await fail("save_product_document", {
      id: b,
      version: d.version + 1,
      product_id: p,
      kind: "SDS",
      language: "en",
      title: "Changed",
      file_url: "https://example.com/change.pdf",
      effective_date: today,
      expiry_date: "",
      notes: "",
    });
    await fail("publish_product_document", { id: a, version: 3 });
  },
);
tx(
  "expired documents are visible as expired, appear in inbox and cannot be newly published",
  async () => {
    const p = await product(),
      a = await document(p);
    await db.query(
      "update erp_product_documents set effective_date='2020-01-01',expiry_date='2020-02-01' where id=$1",
      [a],
    );
    await fail("publish_product_document", { id: a, version: 1 });
    await db.query(
      "update erp_product_documents set state='published' where id=$1",
      [a],
    );
    assert.equal(
      (await read("product_documents", a, token, "expired")).total,
      1,
    );
    assert.ok(
      (await read("inbox")).rows.some(
        (r: { id: string }) => r.id === "document:" + a,
      ),
    );
  },
);
tx(
  "new dashboard contexts return authorized count metrics and complete date series",
  async () => {
    for (const area of ["purchase", "crm", "documents"]) {
      const r = (
        await db.query("select erp_overview($1,$2,'7') r", [token, area])
      ).rows[0].r;
      assert.equal(r.series.length, 7);
      assert.equal(r.metrics.length, 2);
    }
  },
);

tx(
  "receipt reversal restores outstanding quantities and rejects consumed stock",
  async () => {
    const f = await fixture();
    await rpc("receive_purchase", receipt(await confirm(f.order), "0.3"));
    const original = (
      await db.query(
        "select id from erp_material_transactions where order_id=$1",
        [f.order],
      )
    ).rows[0].id;
    const stock = (await read("material_stock")).rows.find(
      (x: { material_id: string }) => x.material_id === f.material,
    );
    const issue = await rpc("issue_material", {
      lot_id: stock.lot_id,
      location_id: location,
      quantity: "0.1",
      date: today,
      reason: "Consumption",
      request_key: randomUUID(),
    });
    await fail("reverse_material_transaction", {
      id: original,
      reason: "Wrong receipt",
    });
    await rpc("reverse_material_transaction", {
      id: issue.id,
      reason: "Undo consumption",
    });
    await rpc("reverse_material_transaction", {
      id: original,
      reason: "Wrong receipt",
    });
    await rpc("reverse_material_transaction", {
      id: original,
      reason: "Replay",
    });
    assert.equal((await getPO(f.order)).state, "confirmed");
    assert.equal((await getPO(f.order)).lines[0].received, "0.000000");
    assert.equal(
      (await read("material_stock", stock.id)).rows[0].quantity,
      "0.000000",
    );
  },
);
tx(
  "opportunity links survive quotation edits and revisions without leaking unrelated customers",
  async () => {
    const id = await opportunity();
    const o = (await read("opportunities", id)).rows[0];
    const c = await rpc("convert_opportunity", { id, version: o.version });
    const p = await product();
    await rpc("save_conversion", {
      product_id: p,
      unit_id: kg,
      factor: "1",
      is_base: true,
    });
    const payload = {
      customer_id: c.id,
      opportunity_id: id,
      date: today,
      valid_until: today,
      currency: "IDR",
      terms: "",
      delivery_terms: "",
      lead_time: "",
      tax_rate: "0",
      freight: "0",
      lines: [
        {
          product_id: p,
          unit_id: kg,
          quantity: "1",
          price: "100",
          discount: "0",
        },
      ],
    };
    const q = await rpc("save_quote", payload);
    assert.equal((await read("quotes", q.id)).rows[0].opportunity_id, id);
    await rpc("save_quote", { ...payload, id: q.id, version: 1 });
    await rpc("issue_quote", { id: q.id, version: 2 });
    const revision = await rpc("revise_quote", { id: q.id });
    assert.equal(
      (await read("quotes", revision.id)).rows[0].opportunity_id,
      id,
    );
    await fail("save_quote", { ...payload, customer_id: randomUUID() });
    await rpc("set_module", { module: "crm", state: "disabled" });
    await rpc("save_quote", { ...payload, id: revision.id, version: 1 });
    assert.equal(
      (await read("quotes", revision.id)).rows[0].opportunity_id,
      id,
    );
    await fail("save_quote", payload);
    await rpc("set_module", { module: "crm", state: "active" });
    const viewerId = (
      await db.query("select user_id from sessions where token=$1", [viewer])
    ).rows[0].user_id;
    await rpc("set_access", {
      user_id: viewerId,
      module: "crm",
      read: true,
      write: false,
      approve: false,
    });
    assert.equal(
      (await read("opportunities", id, viewer)).rows[0].quotes.length,
      0,
    );
    await rpc("set_access", {
      user_id: viewerId,
      module: "sales",
      read: true,
      write: false,
      approve: false,
    });
    assert.ok(
      (await read("opportunities", id, viewer)).rows[0].quotes.length > 0,
    );
    assert.ok(
      (await read("opportunities", id)).rows[0].quotes.some(
        (x: { id: string }) => x.id === q.id,
      ),
    );
  },
);

tx("product document scope includes only the requested product", async () => {
  const p = await product(),
    other = await product(),
    a = await document(p);
  await document(other);
  const scoped = await read("product_documents", "product:" + p);
  assert.equal(scoped.total, 1);
  assert.equal(scoped.rows[0].id, a);
});
test("concurrent receipts with the same version cannot over-receive", async () => {
  const f = await fixture(),
    p = await confirm(f.order),
    clients = [
      new Client({
        connectionString:
          "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
      }),
      new Client({
        connectionString:
          "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
      }),
    ];
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const outcomes = await Promise.allSettled(
      clients.map((c) =>
        c.query("select erp_mutate($1,'receive_purchase',$2)", [
          token,
          JSON.stringify(receipt(p, "0.2")),
        ]),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await getPO(f.order)).lines[0].received, "0.200000");
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});

tx(
  "expired raw material remains physical stock but cannot satisfy reorder thresholds",
  async () => {
    const f = await fixture();
    await rpc("receive_purchase", receipt(await confirm(f.order), "0.3"));
    await db.query("update erp_materials set minimum_stock=0.2 where id=$1", [
      f.material,
    ]);
    assert.equal((await read("materials", f.material)).rows[0].state, "active");
    await db.query(
      "update erp_material_lots set expiry_date=erp_today()-1 where material_id=$1",
      [f.material],
    );
    const m = (await read("materials", f.material)).rows[0];
    assert.equal(m.on_hand, "0.300000");
    assert.equal(m.available, "0");
    assert.equal(m.state, "low_stock");
  },
);

tx(
  "approvers can confirm and publish without draft-edit permission",
  async () => {
    const f = await fixture();
    const viewerId = (
      await db.query("select user_id from sessions where token=$1", [viewer])
    ).rows[0].user_id;
    for (const moduleKey of ["purchase", "documents"]) {
      await rpc("set_access", {
        user_id: viewerId,
        module: moduleKey,
        read: true,
        write: false,
        approve: true,
      });
    }
    const p = await getPO(f.order);
    await rpc("confirm_purchase", { id: p.id, version: p.version }, viewer);
    assert.equal((await getPO(p.id)).state, "confirmed");
    await fail(
      "save_supplier",
      { name: "Forbidden edit", active: true },
      viewer,
    );
    const doc = await document(await product());
    await rpc("publish_product_document", { id: doc, version: 1 }, viewer);
    assert.equal(
      (await read("product_documents", doc)).rows[0].state,
      "published",
    );
  },
);
