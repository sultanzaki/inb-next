import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
const migrations = [
  "018_manufacturing_foundation.sql",
  "019_material_quality.sql",
  "020_manufacturing_execution.sql",
  "021_warehouse_pallets.sql",
  "022_customer_operations.sql",
  "023_operations_gateway.sql",
  "024_warehouse_scope_integrity.sql",
  "025_operations_completion.sql",
  "026_operational_documents.sql",
  "027_operational_access.sql",
];
before(async () => {
  await db.connect();
  for (let repeat = 0; repeat < 2; repeat++)
    for (const file of migrations)
      await db.query(
        await readFile(
          new URL("../src/lib/db/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
});
after(() => db.end());
async function create(sql: string, args: unknown[] = []) {
  return (await db.query(sql + " returning id", args)).rows[0].id as string;
}
async function fixture() {
  const user = await create(
    "insert into users(username,password_hash,role,nama_lengkap) values($1,'test','administrator inbionusa','Manufacturing test')",
    [randomUUID()],
  );
  const token = randomUUID();
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [user, token],
  );
  await db.query("update erp_modules set state='active'");
  await db.query(
    "update erp_operating_policy set locked_through=null,backdate_days=365",
  );
  const code = randomUUID().slice(0, 8),
    unit = await create(
      "insert into erp_units(code,name) values($1,'Kilogram')",
      [code],
    );
  const product = await create(
    "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,'STEARATE 800','Chemical','kg','Halal','Bag')",
    [code],
  );
  await db.query(
    "insert into erp_product_units(product_id,unit_id,factor,is_base) values($1,$2,1,true)",
    [product, unit],
  );
  await db.query(
    "insert into erp_product_series(product_id,series) values($1,$2)",
    [product, String(Math.floor(Math.random() * 100000000))],
  );
  const supplier = await create(
    "insert into erp_suppliers(name) values('Manufacturing supplier')",
  );
  const material = await create(
    "insert into erp_materials(code,name,unit_id,requires_qc,requires_approved_supplier) values($1,'STEARIC ACID',$2,true,true)",
    [code, unit],
  );
  const warehouse = await create(
    "insert into erp_warehouses(code,name) values($1,$2)",
    [code, "Warehouse " + code],
  );
  const location = await create(
    "insert into erp_locations(code,name,warehouse_id) values($1,'Raw and finished storage',$2)",
    [code, warehouse],
  );
  const lot = await create(
    "insert into erp_material_lots(material_id,supplier_id,number,expiry_date) values($1,$2,$3,erp_today()+365)",
    [material, supplier, code],
  );
  await db.query("insert into erp_material_balances values($1,$2,1000)", [
    lot,
    location,
  ]);
  const today = (await db.query("select erp_today()::text date")).rows[0].date;
  return {
    user,
    token,
    unit,
    product,
    supplier,
    material,
    warehouse,
    location,
    lot,
    today,
  };
}
async function action(
  token: string,
  name: string,
  p: Record<string, unknown>,
  request = randomUUID(),
) {
  return (
    await db.query("select erp_work_mutate($1,$2,$3) data", [
      token,
      name,
      { request_key: request, ...p },
    ])
  ).rows[0].data as { id: string; entity: string };
}
async function row(table: string, id: string) {
  return (await db.query(`select * from ${table} where id=$1`, [id])).rows[0];
}
async function rejects(
  token: string,
  name: string,
  p: Record<string, unknown>,
  pattern: RegExp,
) {
  await db.query("savepoint expected_failure");
  try {
    await assert.rejects(action(token, name, p), pattern);
  } finally {
    await db.query("rollback to savepoint expected_failure");
  }
}
async function qualify(f: Awaited<ReturnType<typeof fixture>>) {
  const approved = await action(f.token, "save_approved_supplier", {
    material_id: f.material,
    supplier_id: f.supplier,
    effective_date: f.today,
    reason: "Supplier qualified",
  });
  await action(f.token, "approve_supplier", {
    id: approved.id,
    version: 1,
    reason: "Approved supplier evidence",
  });
  const spec = await action(f.token, "save_material_spec", {
    material_id: f.material,
    title: "Incoming specification",
    parameters: [
      {
        name: "Purity",
        kind: "range",
        minimum: "98",
        maximum: "100",
        unit: "%",
      },
    ],
    effective_date: f.today,
  });
  await action(f.token, "approve_material_spec", {
    id: spec.id,
    version: 1,
    reason: "Approved lab standard",
  });
  const inspection = await action(f.token, "create_incoming_inspection", {
    lot_id: f.lot,
  });
  await action(f.token, "finalize_incoming_inspection", {
    id: inspection.id,
    version: 1,
    results: [{ name: "Purity", value: "99.5" }],
    reason: "Verified incoming result",
  });
  return inspection.id;
}
test("operational collections are authorized, paginated and safe to apply twice", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    for (const entity of [
      "warehouses",
      "locations",
      "warehouse_access",
      "formulas",
      "manufacturing_orders",
      "material_specs",
      "incoming_inspections",
      "approved_suppliers",
      "controlled_documents",
      "deviations",
      "capas",
      "warehouse_transfers",
      "pallets",
      "sample_requests",
      "customer_interactions",
      "document_distributions",
      "materials",
      "suppliers",
      "products",
      "units",
      "staff",
      "customers",
      "opportunities",
      "sales_orders",
      "product_documents",
      "deliveries",
      "material_inventory",
      "finished_inventory",
      "material_lots",
      "finished_lots",
    ]) {
      const result = (
        await db.query("select erp_work_read($1,$2) data", [f.token, entity])
      ).rows[0].data;
      assert.ok(Array.isArray(result.rows), entity);
      assert.equal(result.page_size, 50, entity);
    }
    await db.query("savepoint anonymous");
    await assert.rejects(
      db.query("select erp_work_read('invalid','warehouses')"),
      /Session expired/,
    );
    await db.query("rollback to savepoint anonymous");
  } finally {
    await db.query("rollback");
  }
});
test("material inspection computes FAIL/PASS, preserves snapshots and gates consumption", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    assert.equal(
      (await db.query("select work_material_eligible($1) ok", [f.lot])).rows[0]
        .ok,
      false,
    );
    const inspection = await qualify(f);
    assert.equal(
      (await row("erp_incoming_inspections", inspection)).state,
      "pass",
    );
    assert.equal(
      (await db.query("select work_material_eligible($1) ok", [f.lot])).rows[0]
        .ok,
      true,
    );
    await rejects(
      f.token,
      "save_incoming_results",
      { id: inspection, version: 2, results: [] },
      /changed|finalized/,
    );
    assert.equal(
      (await row("erp_incoming_inspections", inspection)).spec_snapshot
        .parameters[0].minimum,
      "98",
    );
  } finally {
    await db.query("rollback");
  }
});
test("formula reservations do not consume stock; actual consumption, return, output and genealogy reconcile", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    await qualify(f);
    const formula = await action(f.token, "save_formula", {
      product_id: f.product,
      title: "STEARATE formula",
      unit_id: f.unit,
      output_quantity: "100",
      effective_date: f.today,
      lines: [
        {
          material_id: f.material,
          quantity: "100",
          role: "ingredient",
          tolerance_percent: "0",
        },
      ],
    });
    await action(f.token, "approve_formula", {
      id: formula.id,
      version: 1,
      reason: "Formula validated",
    });
    const mo = await action(f.token, "create_manufacturing_order", {
      formula_id: formula.id,
      target_quantity: "100",
      planned_date: f.today,
      location_id: f.location,
    });
    await action(f.token, "release_manufacturing_order", {
      id: mo.id,
      version: 1,
      reason: "Production approved",
    });
    await action(f.token, "reserve_manufacturing_material", {
      id: mo.id,
      version: 2,
      lot_id: f.lot,
      location_id: f.location,
      quantity: "100",
    });
    assert.equal(
      (
        await db.query(
          "select quantity::text n from erp_material_balances where lot_id=$1 and location_id=$2",
          [f.lot, f.location],
        )
      ).rows[0].n,
      "1000.000000",
    );
    const reservation = (
      await db.query(
        "select id from erp_material_reservations where manufacturing_order_id=$1",
        [mo.id],
      )
    ).rows[0].id;
    const request = randomUUID(),
      payload = {
        id: reservation,
        version: 3,
        quantity: "100",
        reason: "Actual weighed use",
      };
    await action(f.token, "consume_material", payload, request);
    await action(f.token, "consume_material", payload, request);
    assert.equal(
      (
        await db.query(
          "select quantity::text n from erp_material_balances where lot_id=$1 and location_id=$2",
          [f.lot, f.location],
        )
      ).rows[0].n,
      "900.000000",
    );
    await action(f.token, "record_manufacturing_output", {
      id: mo.id,
      version: 4,
      quantity: "100",
      mfg_date: f.today,
      reason: "Actual batch output",
    });
    const unfinishedOutput=(await db.query("select lot_id from erp_manufacturing_outputs where manufacturing_order_id=$1",[mo.id])).rows[0].lot_id;
    const shipment=await create("insert into erp_movements(number,kind,date,from_location,reason,lines,created_by) values($1,'issue',erp_today(),$2,'Early shipment test','[]',$3)",[randomUUID(),f.location,f.user]);
    await db.query("savepoint unfinished_batch");
    await assert.rejects(db.query("select erp_delta($1,1,$2,$3,-1)",[shipment,unfinishedOutput,f.location]),/close the production order/);
    await db.query("rollback to savepoint unfinished_batch");
    await action(f.token, "complete_manufacturing_order", {
      id: mo.id,
      version: 5,
      scrap_quantity: "0",
      reason: "All quantities reconciled",
    });
    await action(f.token, "close_manufacturing_order", {
      id: mo.id,
      version: 6,
      reason: "Batch record reviewed",
    });
    assert.equal(
      (await row("erp_manufacturing_orders", mo.id)).state,
      "closed",
    );
    const output = (
      await db.query(
        "select l.* from erp_manufacturing_outputs o join erp_lots l on l.id=o.lot_id where o.manufacturing_order_id=$1",
        [mo.id],
      )
    ).rows[0];
    assert.equal(output.qc_status, "quarantine");
    // A historical posted delivery fixture verifies the downstream read relation.
    await db.query(
      "insert into erp_movements(number,kind,state,date,from_location,reason,lines,snapshot,created_by) values($1,'delivery','posted',erp_today(),$2,'Historical trace fixture',$3,$4,$5)",
      [
        "TRACE-" + randomUUID(),
        f.location,
        JSON.stringify([{ lot_id: output.id, base_quantity: "10" }]),
        { customer: { name: "Trace customer" } },
        f.user,
      ],
    );

    const document = (
      await db.query(
        "select erp_work_document($1,'manufacturing_orders',$2) data",
        [f.token, mo.id],
      )
    ).rows[0].data;
    assert.equal(document.state, "closed");
    assert.equal(document.inputs[0].operator, "Manufacturing test");
    await db.query(
      "update master_produk set nama_produk='Renamed after closure' where id=$1",
      [f.product],
    );
    const frozen = (
      await db.query(
        "select erp_work_document($1,'manufacturing_orders',$2) data",
        [f.token, mo.id],
      )
    ).rows[0].data;
    assert.equal(frozen.product, document.product);
    assert.equal(frozen.closed_by_name, "Manufacturing test");

    const genealogy = (
      await db.query("select erp_work_read($1,'genealogy',$2) data", [
        f.token,
        { id: f.lot },
      ])
    ).rows[0].data;
    assert.equal(genealogy.rows[0].id, mo.id);
    assert.equal(genealogy.rows[0].outputs[0].lot, output.number);
    assert.equal(genealogy.rows[0].deliveries[0].customer, "Trace customer");
  } finally {
    await db.query("rollback");
  }
});
test("warehouse transfer keeps dispatched stock in transit and receives partial quantities exactly once", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const wh = await create(
      "insert into erp_warehouses(code,name) values($1,$2)",
      [randomUUID().slice(0, 8), randomUUID()],
    );
    const dest = await create(
      "insert into erp_locations(code,name,warehouse_id) values($1,'Destination',$2)",
      [randomUUID().slice(0, 8), wh],
    );
    const tr = await action(f.token, "create_warehouse_transfer", {
      from_location: f.location,
      to_location: dest,
      reason: "Replenish destination",
      lines: [{ kind: "material", lot_id: f.lot, quantity: "100" }],
    });
    await action(f.token, "dispatch_warehouse_transfer", {
      id: tr.id,
      version: 1,
    });
    assert.equal(
      (
        await db.query(
          "select coalesce(sum(quantity),0)::text n from erp_material_balances where lot_id=$1 and location_id=$2",
          [f.lot, dest],
        )
      ).rows[0].n,
      "0",
    );
    const line = (
      await db.query("select id from erp_transfer_lines where transfer_id=$1", [
        tr.id,
      ])
    ).rows[0].id;
    await action(f.token, "receive_warehouse_transfer", {
      id: tr.id,
      version: 2,
      lines: [{ line_id: line, quantity: "60" }],
      reason: "First arrival",
    });
    assert.equal(
      (await row("erp_warehouse_transfers", tr.id)).state,
      "partial",
    );
    await rejects(
      f.token,
      "receive_warehouse_transfer",
      { id: tr.id, version: 3, lines: [{ line_id: line, quantity: "50" }] },
      /outstanding/,
    );
    await action(f.token, "receive_warehouse_transfer", {
      id: tr.id,
      version: 3,
      lines: [{ line_id: line, quantity: "40" }],
      reason: "Final arrival",
    });
    assert.equal(
      (await row("erp_warehouse_transfers", tr.id)).state,
      "received",
    );
    assert.equal(
      (
        await db.query(
          "select sum(quantity)::text n from erp_material_balances where lot_id=$1",
          [f.lot],
        )
      ).rows[0].n,
      "1000.000000",
    );
  } finally {
    await db.query("rollback");
  }
});

async function readWork(
  token: string,
  entity: string,
  query: Record<string, unknown> = {},
) {
  return (
    await db.query("select erp_work_read($1,$2,$3) data", [
      token,
      entity,
      query,
    ])
  ).rows[0].data;
}
async function balance(lot: string, location: string, finished = false) {
  return Number(
    (
      await db.query(
        `select quantity from ${finished ? "erp_balances" : "erp_material_balances"} where lot_id=$1 and location_id=$2`,
        [lot, location],
      )
    ).rows[0]?.quantity || 0,
  );
}
test("pallet packing, partial repack, in-transit manifest and shortages preserve stock", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const a = await action(f.token, "create_pallet", {
        location_id: f.location,
      }),
      b = await action(f.token, "create_pallet", { location_id: f.location });
    await action(f.token, "pack_pallet", {
      id: a.id,
      version: 1,
      kind: "material",
      lot_id: f.lot,
      quantity: "100",
      reason: "Pack incoming bags",
    });
    const content = (await readWork(f.token, "pallets", { id: a.id })).rows[0]
      .contents[0];
    const request = randomUUID(),
      payload = {
        id: a.id,
        version: 2,
        content_id: content.id,
        quantity: "30",
        destination_pallet: b.id,
        destination_version: 1,
        reason: "Split pallet for transfer",
      };
    await action(f.token, "repack_pallet", payload, request);
    await action(f.token, "repack_pallet", payload, request);
    assert.equal(await balance(f.lot, f.location), 1000);
    assert.equal(
      (await readWork(f.token, "pallets", { id: a.id })).rows[0].contents[0]
        .quantity,
      "70.000000",
    );
    assert.equal(
      (await readWork(f.token, "pallets", { id: b.id })).rows[0].contents[0]
        .quantity,
      "30.000000",
    );
    const wh = await create(
      "insert into erp_warehouses(code,name) values($1,$2)",
      [randomUUID().slice(0, 8), randomUUID()],
    );
    const dest = await create(
      "insert into erp_locations(code,name,warehouse_id) values($1,'Pallet destination',$2)",
      [randomUUID().slice(0, 8), wh],
    );
    const transfer = await action(f.token, "create_warehouse_transfer", {
      from_location: f.location,
      to_location: dest,
      reason: "Transfer packed bags",
      pallet_ids: [b.id],
    });
    await action(f.token, "dispatch_warehouse_transfer", {
      id: transfer.id,
      version: 1,
    });
    assert.equal(await balance(f.lot, f.location), 970);
    assert.equal(await balance(f.lot, dest), 0);
    assert.equal((await row("erp_pallets", b.id)).state, "in_transit");
    const line = (
      await readWork(f.token, "warehouse_transfers", { id: transfer.id })
    ).rows[0].lines[0];
    await rejects(
      f.token,
      "receive_warehouse_transfer",
      {
        id: transfer.id,
        version: 2,
        lines: [{ line_id: line.id, quantity: "20" }],
      },
      /complete pallet/,
    );
    await action(f.token, "receive_warehouse_transfer", {
      id: transfer.id,
      version: 2,
      lines: [{ line_id: line.id, quantity: "28", lost_quantity: "2" }],
      reason: "Two bags damaged in transit",
    });
    assert.equal(await balance(f.lot, dest), 28);
    assert.equal((await row("erp_pallets", b.id)).location_id, dest);
    assert.equal(
      (await row("erp_warehouse_transfers", transfer.id)).state,
      "closed",
    );
    const history = await readWork(f.token, "history", {
      id: a.id,
      source: "pallets",
    });
    assert.ok(
      history.rows.some(
        (e: Record<string, unknown>) => e.entity === "pallet_contents",
      ),
    );
  } finally {
    await db.query("rollback");
  }
});
test("failed incoming lots require an approved retest and cannot bypass rejection via policy", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const prior = await qualify(f);
    await rejects(
      f.token,
      "create_incoming_inspection",
      { lot_id: f.lot },
      /deviation-approved retest/,
    );
    const deviation = await action(f.token, "save_deviation", {
      inspection_id: prior,
      title: "Supplier result investigation",
      description: "Inspect a possible sample mix-up",
      investigation: "Retained sample identity checked",
      disposition: "Retest retained sample",
      due_date: f.today,
    });
    await action(f.token, "submit_deviation", { id: deviation.id, version: 1 });
    await action(f.token, "approve_deviation", {
      id: deviation.id,
      version: 2,
      reason: "Retest scope independently reviewed",
    });
    const retest = await action(f.token, "retest_incoming_inspection", {
      id: prior,
      version: 2,
      deviation_id: deviation.id,
    });
    await action(f.token, "finalize_incoming_inspection", {
      id: retest.id,
      version: 1,
      results: [{ name: "Purity", value: "97" }],
      failure_reason: "Purity below approved limit",
      reason: "Actual retained sample result",
    });
    await db.query(
      "update erp_materials set requires_qc=false,requires_approved_supplier=false where id=$1",
      [f.material],
    );
    assert.equal(
      (await db.query("select work_material_eligible($1) ok", [f.lot])).rows[0]
        .ok,
      false,
    );
    await rejects(
      f.token,
      "hold_material_quality",
      { id: f.lot, hold: false, reason: "Attempt to bypass rejected material" },
      /cannot be removed/,
    );
    const capa = await action(f.token, "save_capa", {
      deviation_id: deviation.id,
      title: "Supplier corrective action",
      kind: "corrective",
      action: "Review supplier process",
      assignee: f.user,
      due_date: f.today,
      evidence: "Supplier report attached",
      effectiveness: "Pending verification",
    });
    await rejects(
      f.token,
      "close_deviation",
      { id: deviation.id, version: 3, reason: "Close too early" },
      /CAPA/,
    );
    await action(f.token, "submit_capa", { id: capa.id, version: 1 });
    await action(f.token, "verify_capa", {
      id: capa.id,
      version: 2,
      effectiveness: "Three subsequent lots met specifications",
      reason: "Effectiveness confirmed",
    });
    await action(f.token, "close_deviation", {
      id: deviation.id,
      version: 3,
      reason: "All actions verified",
    });
  } finally {
    await db.query("rollback");
  }
});
test("warehouse scope filters old and new inventory and prevents forged location writes", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const wh = await create(
      "insert into erp_warehouses(code,name) values($1,$2)",
      [randomUUID().slice(0, 8), randomUUID()],
    );
    const hidden = await create(
      "insert into erp_locations(code,name,warehouse_id) values($1,'Hidden stock',$2)",
      [randomUUID().slice(0, 8), wh],
    );
    await db.query("insert into erp_material_balances values($1,$2,20)", [
      f.lot,
      hidden,
    ]);
    const hiddenLot = await create(
      "insert into erp_lots(product_id,number) values($1,$2)",
      [f.product, randomUUID()],
    );
    await db.query("insert into erp_balances values($1,$2,20)", [
      hiddenLot,
      hidden,
    ]);
    const hiddenCase = await create(
      "insert into erp_cases(number,kind,source_type,source_id,source_snapshot,title,created_by) values($1,'quality_retest','lot',$2,'{}','Restricted warehouse case',$3)",
      [randomUUID(), hiddenLot, f.user],
    );
    await db.query("update users set role='warehouse_manager' where id=$1", [
      f.user,
    ]);
    await db.query(
      "insert into erp_access(user_id,module,can_read,can_write,can_approve) select $1,key,true,true,true from erp_modules on conflict(user_id,module) do update set can_read=true,can_write=true,can_approve=true",
      [f.user],
    );
    await db.query("insert into erp_warehouse_scopes values($1,true)", [
      f.user,
    ]);
    await db.query(
      "insert into erp_warehouse_access values($1,$2,true,true,true)",
      [f.user, f.warehouse],
    );
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [f.user, f.token],
    );

    const inventory = await readWork(f.token, "material_inventory");
    assert.ok(inventory.rows.length > 0);
    assert.ok(
      inventory.rows.every(
        (r: Record<string, unknown>) => r.location_id === f.location,
      ),
    );
    const hiddenCases = (
      await db.query("select erp_read($1,'ops_cases','','',1,$2) data", [
        f.token,
        hiddenCase,
      ])
    ).rows[0].data;
    assert.equal(hiddenCases.rows.length, 0);
    await db.query("savepoint hidden_case_write");
    await db.query("select set_config('inb.actor',$1,true)", [f.user]);
    await assert.rejects(
      db.query("update erp_cases set title='Forged edit' where id=$1", [
        hiddenCase,
      ]),
      /outside your assigned/,
    );
    await db.query("rollback to savepoint hidden_case_write");
    const legacy = (
      await db.query("select erp_read($1,'material_stock') data", [f.token])
    ).rows[0].data;
    assert.ok(
      legacy.rows.every(
        (r: Record<string, unknown>) => r.location_id === f.location,
      ),
    );
    await rejects(
      f.token,
      "create_pallet",
      { location_id: hidden },
      /warehouse or location/,
    );
    await rejects(
      f.token,
      "set_warehouse_access",
      { user_id: f.user, restricted: false, warehouses: [] },
      /permission denied|insufficient_privilege/,
    );
    await db.query(
      "update erp_modules set state='read_only' where key='warehouse'",
    );
    await rejects(
      f.token,
      "create_pallet",
      { location_id: f.location },
      /permission denied|read.only|Module/,
    );
  } finally {
    await db.query("rollback");
  }
});
test("samples reserve, ship exactly once, capture feedback and create one quotation", async () => {
  await db.query("begin");
  try {
    const f = await fixture(),
      customer = await create(
        "insert into erp_customers(name) values('Sample customer')",
      );
    const lot = await create(
      "insert into erp_lots(product_id,number,mfg_date,expiry_date,qc_status) values($1,$2,erp_today(),erp_today()+365,'released')",
      [f.product, randomUUID()],
    );
    await db.query("insert into erp_balances values($1,$2,100)", [
      lot,
      f.location,
    ]);
    const sample = await action(f.token, "create_sample_request", {
      customer_id: customer,
      product_id: f.product,
      unit_id: f.unit,
      quantity: "5",
      purpose: "Customer process trial",
      due_date: f.today,
    });
    await action(f.token, "approve_sample", {
      id: sample.id,
      version: 1,
      reason: "Approved customer trial",
    });
    await action(f.token, "prepare_sample", {
      id: sample.id,
      version: 2,
      lot_id: lot,
      location_id: f.location,
    });
    assert.equal(await balance(lot, f.location, true), 100);
    assert.equal(
      Number(
        (await db.query("select erp_reserved($1,$2) n", [lot, f.location]))
          .rows[0].n,
      ),
      5,
    );
    const request = randomUUID(),
      p = {
        id: sample.id,
        version: 3,
        tracking_reference: "LOCAL-TRACK-1",
        reason: "Handed to courier",
      };
    await action(f.token, "ship_sample", p, request);
    await action(f.token, "ship_sample", p, request);
    assert.equal(await balance(lot, f.location, true), 95);
    await action(f.token, "record_sample_feedback", {
      id: sample.id,
      version: 4,
      feedback: "Trial accepted; request commercial quotation",
    });
    await action(f.token, "create_sample_quotation", {
      id: sample.id,
      version: 5,
      quantity: "100",
      price: "12000",
      currency: "IDR",
      valid_until: f.today,
      tax_rate: "0",
    });
    const result = await row("erp_sample_requests", sample.id);
    assert.equal(result.state, "converted");
    assert.ok(result.quote_id);
    await rejects(
      f.token,
      "create_sample_quotation",
      {
        id: sample.id,
        version: 6,
        quantity: "100",
        price: "12000",
        currency: "IDR",
        valid_until: f.today,
      },
      /feedback|quotation/,
    );
  } finally {
    await db.query("rollback");
  }
});
test("controlled document revisions and distribution retain the sent revision", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const doc = await action(f.token, "save_controlled_document", {
      material_id: f.material,
      title: "Material safety sheet",
      kind: "SDS",
      language: "en",
      file_url: "https://example.com/sds-v1.pdf",
      effective_date: f.today,
    });
    await action(f.token, "publish_controlled_document", {
      id: doc.id,
      version: 1,
      reason: "Verified material document",
    });
    await rejects(
      f.token,
      "save_controlled_document",
      { id: doc.id, version: 2, title: "Overwrite published revision" },
      /constraint|immutable|revision/,
    );
    const revision = await action(f.token, "revise_controlled_document", {
      id: doc.id,
      version: 2,
      reason: "Updated supplier revision",
    });
    assert.equal(
      (await row("erp_controlled_documents", revision.id)).revision,
      2,
    );
    const customer = await create(
      "insert into erp_customers(name) values('Document customer')",
    );
    const productDoc = await create(
      "insert into erp_product_documents(number,product_id,kind,title,language,revision,file_url,effective_date,state,created_by) values($1,$2,'SDS','Product SDS','en',1,'https://example.com/product-v1.pdf',erp_today(),'published',$3)",
      [randomUUID(), f.product, f.user],
    );
    const distribution = await action(f.token, "distribute_product_document", {
      customer_id: customer,
      document_id: productDoc,
      recipient: "Customer QA",
      channel: "email",
      sent_date: f.today,
      evidence: "Sent by company email",
    });
    await action(f.token, "acknowledge_document_distribution", {
      id: distribution.id,
      version: 1,
      acknowledged_date: f.today,
      evidence: "Customer acknowledged receipt",
    });
    assert.equal(
      (await row("erp_document_distributions", distribution.id))
        .document_snapshot.revision,
      1,
    );
  } finally {
    await db.query("rollback");
  }
});

test("material returns and deviations reconcile actual use; closed batch records cannot be edited", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    await qualify(f);
    const formula = await action(f.token, "save_formula", {
      product_id: f.product,
      title: "Return material formula",
      unit_id: f.unit,
      output_quantity: "100",
      effective_date: f.today,
      lines: [
        {
          material_id: f.material,
          quantity: "100",
          role: "ingredient",
          tolerance_percent: "0",
        },
      ],
    });
    await action(f.token, "approve_formula", {
      id: formula.id,
      version: 1,
      reason: "Formula approved",
    });
    const mo = await action(f.token, "create_manufacturing_order", {
      formula_id: formula.id,
      target_quantity: "100",
      planned_date: f.today,
      location_id: f.location,
    });
    await action(f.token, "release_manufacturing_order", {
      id: mo.id,
      version: 1,
      reason: "Batch released",
    });
    await action(f.token, "reserve_manufacturing_material", {
      id: mo.id,
      version: 2,
      lot_id: f.lot,
      location_id: f.location,
      quantity: "100",
    });
    const reservation = (
      await db.query(
        "select id from erp_material_reservations where manufacturing_order_id=$1",
        [mo.id],
      )
    ).rows[0].id;
    await action(f.token, "consume_material", {
      id: reservation,
      version: 3,
      quantity: "100",
      reason: "Weighed material issued",
    });
    const input = (
      await db.query(
        "select * from erp_manufacturing_inputs where manufacturing_order_id=$1",
        [mo.id],
      )
    ).rows[0];
    await action(f.token, "return_manufacturing_material", {
      id: input.id,
      version: 4,
      quantity: "10",
      reason: "Unused sealed material returned",
    });
    assert.equal(await balance(f.lot, f.location), 910);
    await rejects(
      f.token,
      "return_manufacturing_material",
      {
        id: input.id,
        version: 5,
        quantity: "91",
        reason: "Excess material return",
      },
      /quantity|constraint|return/,
    );
    await db.query("savepoint controlled_reverse");
    await assert.rejects(
      db.query("select erp_mutate($1,'reverse_material_transaction',$2)", [
        f.token,
        { id: input.transaction_id, reason: "Bypass production return" },
      ]),
      /production material return/,
    );
    await db.query("rollback to savepoint controlled_reverse");
    await action(f.token, "record_manufacturing_output", {
      id: mo.id,
      version: 5,
      quantity: "90",
      mfg_date: f.today,
      reason: "Actual production output",
    });
    await rejects(
      f.token,
      "complete_manufacturing_order",
      {
        id: mo.id,
        version: 6,
        scrap_quantity: "10",
        reason: "Reconcile material usage",
      },
      /deviation/,
    );
    const dev = await action(f.token, "save_deviation", {
      manufacturing_order_id: mo.id,
      title: "Material usage variance",
      description: "Ten kilograms returned",
      investigation: "Actual yield reviewed",
      disposition: "Accept measured material variance",
      due_date: f.today,
    });
    await action(f.token, "submit_deviation", { id: dev.id, version: 1 });
    await action(f.token, "approve_deviation", {
      id: dev.id,
      version: 2,
      reason: "Variance accepted with evidence",
    });
    await action(f.token, "complete_manufacturing_order", {
      id: mo.id,
      version: 6,
      scrap_quantity: "10",
      reason: "All actuals reconciled",
    });
    await action(f.token, "close_manufacturing_order", {
      id: mo.id,
      version: 7,
      reason: "Batch reviewed and closed",
    });
    await db.query("savepoint immutable_batch");
    await assert.rejects(
      db.query(
        "update erp_manufacturing_orders set notes='Overwrite' where id=$1",
        [mo.id],
      ),
      /immutable/,
    );
    await db.query("rollback to savepoint immutable_batch");
  } finally {
    await db.query("rollback");
  }
});
test("workflow helpers and work tables cannot be invoked directly by application roles", async () => {
  const functions = (
    await db.query(
      "select p.oid::regprocedure::text name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'work_%'",
    )
  ).rows;
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const f of functions)
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [
            role,
            f.name,
          ])
        ).rows[0].ok,
        false,
        role + ": " + f.name,
      );
    for (const table of [
      "erp_manufacturing_orders",
      "erp_pallets",
      "erp_material_reservations",
      "erp_work_requests",
    ])
      assert.equal(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT') ok", [
            role,
            table,
          ])
        ).rows[0].ok,
        false,
        role + ": " + table,
      );
  }
});
test("simultaneous replay requests create exactly one pallet", async () => {
  const f = await fixture();
  const request = randomUUID(),
    payload = { request_key: request, location_id: f.location };
  const clients = [
    new Client({
      connectionString:
        "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
    }),
    new Client({
      connectionString:
        "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
    }),
  ];
  try {
    await Promise.all(clients.map((c) => c.connect()));
    const results = await Promise.all(
      clients.map((c) =>
        c.query("select erp_work_mutate($1,'create_pallet',$2) data", [
          f.token,
          payload,
        ]),
      ),
    );
    assert.equal(results[0].rows[0].data.id, results[1].rows[0].data.id);
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) n from erp_pallets where created_by=$1",
            [f.user],
          )
        ).rows[0].n,
      ),
      1,
    );
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});

test("an independent approver can approve material specifications without draft-edit permission", async () => {
  await db.query("begin");
  try {
    const f = await fixture();
    const spec = await action(f.token, "save_material_spec", {
      material_id: f.material,
      title: "Independent approval test",
      effective_date: f.today,
      parameters: [{ name: "Color", kind: "text", expected: "White" }],
    });
    const approver = await create(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'test','viewer','Independent approver')",
      [randomUUID()],
    );
    await db.query(
      "insert into erp_access(user_id,module,can_read,can_write,can_approve) values($1,'quality',true,false,true)",
      [approver],
    );
    const token = randomUUID();
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [approver, token],
    );
    await action(token, "approve_material_spec", {
      id: spec.id,
      version: 1,
      reason: "Independently reviewed standard",
    });
    assert.equal((await row("erp_material_specs", spec.id)).state, "approved");
    await rejects(
      token,
      "save_material_spec",
      {
        material_id: f.material,
        title: "Unauthorized draft",
        effective_date: f.today,
        parameters: [],
      },
      /denied/,
    );
  } finally {
    await db.query("rollback");
  }
});
