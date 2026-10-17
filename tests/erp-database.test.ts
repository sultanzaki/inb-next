import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:local-test-only@127.0.0.1:55432/postgres";
const parsed = new URL(url);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "55432"
)
  throw Error("Use the disposable loopback database only.");
const db = new Client({ connectionString: url });
let token: string,
  operator: string,
  operatorId: string,
  today: string,
  expiry: string,
  kg: string,
  main: string;
async function rpc(
  action: string,
  payload: unknown,
  session = token,
  client = db,
) {
  return (
    await client.query("select erp_mutate($1,$2,$3) r", [
      session,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].r;
}
async function qc(action: string, payload: unknown) {
  return (
    await db.query("select qc_mutate($1,$2,$3) r", [
      token,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].r;
}
async function read(entity: string, id?: string, session = token) {
  return (
    await db.query("select erp_read($1,$2,$3,$4,$5,$6)", [
      session,
      entity,
      "",
      "",
      1,
      id ?? null,
    ])
  ).rows[0].erp_read;
}
async function failure(
  action: string,
  payload: unknown,
  code?: string,
  session = token,
) {
  await db.query("savepoint expected_error");
  try {
    await assert.rejects(
      () => rpc(action, payload, session),
      (e) => {
        if (code) assert.equal((e as { code: string }).code, code);
        return true;
      },
    );
  } finally {
    await db.query("rollback to savepoint expected_error");
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
async function product() {
  return (
    await qc("create_produk", {
      kode_produk: "ERP-" + randomUUID(),
      nama_produk: "ERP magnesium stearate",
      kategori: "Chemical",
      satuan: "kg",
      status_halal: "Halal",
      tipe_kemasan: "Bag",
      spesifikasi: [
        {
          parameter_uji: "pH",
          tipe_batas: "RANGE",
          nilai_min: "6",
          nilai_maks: "8",
          satuan: "",
          keterangan: "",
        },
      ],
    })
  ).id as string;
}
async function stock(qty = "100") {
  const p = await product(),
    batch = "ERP-" + randomUUID();
  const m = await rpc("save_move", {
    kind: "production",
    date: today,
    to_location: main,
    reason: "Finished output",
    lines: [
      {
        product_id: p,
        unit_id: kg,
        quantity: qty,
        lot_number: batch,
        mfg_date: today,
      },
    ],
  });
  await rpc("post_move", m);
  const lot = (
    await db.query(
      "select id from erp_lots where product_id=$1 and number=$2",
      [p, batch],
    )
  ).rows[0].id;
  return { p, batch, m, lot };
}
async function release(s: Awaited<ReturnType<typeof stock>>, val = "7") {
  const spec = (
    await db.query("select id from spesifikasi where id_produk=$1", [s.p])
  ).rows[0].id;
  return qc("create_uji", {
    id_produk: s.p,
    no_lot: s.batch,
    tgl_sampling: today,
    tgl_uji: today,
    inspector: "ERP QA",
    catatan: "Test",
    failure_reason: val === "7" ? "" : "Outside range",
    status: val === "7" ? "PASS" : "FAIL",
    hasil_detail: [
      { spec_id: spec, p: "pH", val, st: val === "7" ? "PASS" : "FAIL" },
    ],
  });
}
async function certificate(h: { id: string }) {
  return qc("issue_coa", {
    id_hasil: h.id,
    no_coa: "",
    tanggal_rilis: today,
    tanggal_expired: expiry,
    mfg_date: today,
    tanda_tangan: "QA original",
    language: "en",
  });
}
async function quotation(p: string, qty = "20", discount = "0") {
  const c = await rpc("save_customer", {
    name: "ERP customer " + randomUUID(),
    billing_address: "Original billing address",
    shipping_address: "Original delivery address",
  });
  return rpc("save_quote", {
    customer_id: c.id,
    date: today,
    valid_until: expiry,
    currency: "IDR",
    terms: "30 days",
    tax_rate: "11",
    freight: "2.50",
    lines: [
      { product_id: p, unit_id: kg, quantity: qty, price: "12.345", discount },
    ],
  });
}
async function order(p: string, qty = "20") {
  const q = await quotation(p, qty);
  await rpc("issue_quote", q);
  await rpc("accept_quote", q);
  return rpc("convert_quote", q);
}
async function reserve(o: { id: string }, lot: string, qty = "20") {
  const line = (
    await db.query("select id from erp_order_lines where order_id=$1", [o.id])
  ).rows[0].id;
  return rpc("reserve", {
    order_line_id: line,
    lot_id: lot,
    location_id: main,
    quantity: qty,
  });
}
before(async () => {
  await db.connect();
  for (const role of ["admin qc", "viewer"]) {
    const t = randomUUID(),
      u = (
        await db.query(
          "insert into users(username,password_hash,role,nama_lengkap) values($1,$2,$3,$4) returning id",
          ["erp-" + t, "local-only", role, "ERP QA " + role],
        )
      ).rows[0].id;
    await db.query(
      "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [u, t],
    );
    if (role === "admin qc") token = t;
    else {
      operator = t;
      operatorId = u;
    }
  }
  const dates = (
    await db.query(
      "select erp_today()::text today,(erp_today()+interval '1 year')::date::text expiry",
    )
  ).rows[0];
  today = dates.today;
  expiry = dates.expiry;
  kg = (await db.query("select id from erp_units where code='kg'")).rows[0].id;
  main = (await db.query("select id from erp_locations where code='MAIN'"))
    .rows[0].id;
});
after(() => db.end());
tx(
  "ERP production uses exact decimals, quarantine and idempotent posting",
  async () => {
    const s = await stock("0.3");
    await rpc("post_move", s.m);
    const rows = (await read("stock")).rows.filter(
      (r: { lot_id: string }) => r.lot_id === s.lot,
    );
    assert.equal(rows[0].on_hand, "0.300000");
    assert.equal(rows[0].available, "0");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_ledger where movement_id=$1",
          [s.m.id],
        )
      ).rows[0].n,
      1,
    );
    const o = await order(s.p, "0.1");
    await failure(
      "reserve",
      {
        order_line_id: (await read("orders", o.id)).rows[0].lines[0].id,
        lot_id: s.lot,
        location_id: main,
        quantity: "0.1",
      },
      "P0001",
    );
    await failure("reverse_move", { id: s.m.id, reason: "" }, "P0001");
  },
);
tx(
  "ERP QC release, partial dispatch, frozen COA packet and delivery reversal stay reconciled",
  async () => {
    const s = await stock(),
      h = await release(s),
      coa = await certificate(h),
      o = await order(s.p);
    const r = await reserve(o, s.lot);
    const delivery = await rpc("create_delivery", {
      order_id: o.id,
      reason: "Partial shipment",
      lines: [{ reservation_id: r.id, quantity: "5" }],
    });
    await rpc("post_move", delivery);
    await rpc("post_move", delivery);
    const b = (
      await db.query(
        "select quantity::text q from erp_balances where lot_id=$1",
        [s.lot],
      )
    ).rows[0];
    assert.equal(b.q, "95.000000");
    let details = (await read("orders", o.id)).rows[0];
    assert.equal(details.lines[0].delivered, "5.000000");
    assert.equal(details.lines[0].reserved, "15.000000");
    assert.equal(details.state, "confirmed");
    const stored = (await read("movements", delivery.id)).rows[0];
    assert.equal(
      stored.snapshot.lines[0].coa.tanda_tangan_digital,
      "QA original",
    );
    const original = (
      await db.query("select no_coa from coa where id=$1", [coa.id])
    ).rows[0];
    await qc("update_coa", {
      id: coa.id,
      no_coa: original.no_coa,
      tanggal_rilis: today,
      tanggal_expired: expiry,
      mfg_date: today,
      tanda_tangan: "Changed issuer",
      language: "en",
    });
    assert.equal(
      (await read("movements", delivery.id)).rows[0].snapshot.lines[0].coa
        .tanda_tangan_digital,
      "QA original",
    );
    await failure(
      "reverse_move",
      { id: s.m.id, reason: "Cannot remove dispatched stock" },
      "P0001",
    );
    await rpc("reverse_move", {
      id: delivery.id,
      reason: "Shipment cancelled",
    });
    details = (await read("orders", o.id)).rows[0];
    assert.equal(details.lines[0].delivered, "0.000000");
    assert.equal(
      (
        await db.query(
          "select quantity::text q from erp_balances where lot_id=$1",
          [s.lot],
        )
      ).rows[0].q,
      "100.000000",
    );
    assert.equal(
      (
        await db.query(
          "select sum(delta)::text total from erp_ledger where lot_id=$1",
          [s.lot],
        )
      ).rows[0].total,
      "100.000000",
    );
  },
);
tx(
  "ERP refuses shipment without matching COA and stops later QC failure",
  async () => {
    const s = await stock();
    await release(s);
    const o = await order(s.p),
      r = await reserve(o, s.lot);
    const d = await rpc("create_delivery", {
      order_id: o.id,
      lines: [{ reservation_id: r.id, quantity: "5" }],
    });
    await failure("post_move", d, "P0001");
    await rpc("unreserve", { ...r, reason: "Release before retesting" });
    const h = (
      await db.query(
        "select * from hasil_uji where id_produk=$1 and no_lot=$2",
        [s.p, s.batch],
      )
    ).rows[0];
    await qc("update_uji", {
      id: h.id,
      id_produk: s.p,
      no_lot: s.batch,
      tgl_sampling: today,
      tgl_uji: today,
      inspector: "ERP QA",
      catatan: "Retest",
      failure_reason: "Failed pH",
      status: "FAIL",
      hasil_detail: [
        { spec_id: h.hasil_detail[0].spec_id, p: "pH", val: "9", st: "FAIL" },
      ],
    });
    assert.equal(
      (await db.query("select qc_status from erp_lots where id=$1", [s.lot]))
        .rows[0].qc_status,
      "rejected",
    );
  },
);
tx(
  "ERP stock counts freeze locations, hide blind baselines and post auditable variances",
  async () => {
    const s = await stock("10");
    await rpc("set_access", {
      user_id: operatorId,
      module: "warehouse",
      read: true,
      write: true,
      approve: false,
    });
    const c = await rpc(
      "create_count",
      {
        location_id: main,
        scheduled_date: today,
        blind: true,
        reason: "Cycle count",
      },
      operator,
    );
    await rpc("start_count", c, operator);
    const view = { lines: (await read("count_lines", c.id, operator)).rows };
    assert.equal(
      view.lines.find((l: { lot_id: string }) => l.lot_id === s.lot).baseline,
      null,
    );
    const blocked = await rpc("save_move", {
      kind: "issue",
      date: today,
      from_location: main,
      reason: "Sample",
      lines: [{ lot_id: s.lot, unit_id: kg, quantity: "1" }],
    });
    await failure("post_move", blocked, "P0001");
    await failure("submit_count", c, "P0001", operator);
    for (const line of view.lines)
      await rpc(
        "count_line",
        {
          id: c.id,
          lot_id: line.lot_id,
          quantity: line.lot_id === s.lot ? "9.5" : "0",
        },
        operator,
      );
    await rpc("submit_count", c, operator);
    await failure(
      "approve_count",
      { id: c.id, reason: "Self approval" },
      "42501",
      operator,
    );
    const posted = await rpc("approve_count", {
      id: c.id,
      reason: "Verified physical difference",
    });
    assert.equal(
      (
        await db.query(
          "select quantity::text q from erp_balances where lot_id=$1",
          [s.lot],
        )
      ).rows[0].q,
      "9.500000",
    );
    assert.equal(
      (
        await db.query(
          "select delta::text d from erp_ledger where movement_id=$1",
          [posted.id],
        )
      ).rows[0].d,
      "-0.500000",
    );
    await rpc("post_move", blocked);
  },
);
tx(
  "ERP unlisted count lines and cancellation preserve the freeze boundary",
  async () => {
    const p = await product(),
      c = await rpc("create_count", {
        location_id: main,
        scheduled_date: today,
        blind: true,
        reason: "Empty location",
      });
    await rpc("start_count", c);
    await rpc("count_add_lot", {
      id: c.id,
      product_id: p,
      lot_number: "FOUND-" + randomUUID(),
      mfg_date: today,
    });
    const detail = await read("count_lines", c.id);
    assert.ok(detail.rows.length > 0);
    await rpc("cancel_count", { id: c.id, reason: "Replan count" });
    assert.equal((await read("counts", c.id)).rows[0].state, "cancelled");
  },
);
tx(
  "ERP quotation snapshots, revisions, acceptance and conversion are immutable and exact",
  async () => {
    const p = await product(),
      q = await quotation(p, "3", "5");
    await rpc("issue_quote", q);
    const issued = (await read("quotes", q.id)).rows[0];
    assert.equal(issued.totals.subtotal, "35.18");
    assert.equal(issued.totals.tax, "3.87");
    assert.equal(issued.totals.total, "41.55");
    await rpc("save_customer", {
      id: issued.customer_id,
      name: "Renamed customer",
      billing_address: "Different address",
    });
    assert.equal(
      (await read("quotes", q.id)).rows[0].snapshot.customer.billing_address,
      "Original billing address",
    );
    const rev = await rpc("revise_quote", q);
    let revised = (await read("quotes", rev.id)).rows[0];
    assert.equal(revised.revision, 2);
    await rpc("save_quote", {
      id: rev.id,
      version: revised.version,
      customer_id: revised.customer_id,
      date: today,
      valid_until: expiry,
      currency: "IDR",
      lines: revised.lines,
      tax_rate: "0",
      freight: "0",
      terms: "Revised terms",
    });
    revised = (await read("quotes", rev.id)).rows[0];
    await rpc("issue_quote", rev);
    assert.equal((await read("quotes", q.id)).rows[0].state, "superseded");
    await rpc("accept_quote", rev);
    const o = await rpc("convert_quote", rev);
    assert.equal((await rpc("convert_quote", rev)).id, o.id);
    await failure("revise_quote", rev, "P0001");
    await failure(
      "save_quote",
      { ...revised, id: rev.id, version: 1 },
      "P0001",
    );
  },
);
tx(
  "ERP discount approval and per-module permissions deny privilege escalation",
  async () => {
    await rpc("set_access", {
      user_id: operatorId,
      module: "sales",
      read: true,
      write: true,
      approve: false,
    });
    const p = await product(),
      q = await quotation(p, "2", "15");
    await rpc("issue_quote", q, operator);
    assert.equal((await read("quotes", q.id)).rows[0].state, "pending");
    await failure(
      "approve_quote",
      { ...q, reason: "Unauthorized" },
      "42501",
      operator,
    );
    await rpc("approve_quote", { ...q, reason: "Approved contract discount" });
    await failure(
      "set_module",
      { module: "sales", state: "disabled" },
      "42501",
      operator,
    );
    await failure(
      "save_unit",
      { code: "HACK", name: "Unauthorized" },
      "42501",
      operator,
    );
    await rpc("set_access", {
      user_id: operatorId,
      module: "sales",
      read: false,
      write: false,
      approve: false,
    });
    await db.query("savepoint read_denied");
    await assert.rejects(
      () => read("quotes", q.id, operator),
      (e) => (e as { code: string }).code === "42501",
    );
    await db.query("rollback to savepoint read_denied");
  },
);
tx(
  "ERP manual conversions are product-specific and cannot redefine used base units",
  async () => {
    const p = await product(),
      bag = (await db.query("select id from erp_units where code='bag'"))
        .rows[0].id;
    await rpc("save_conversion", {
      product_id: p,
      unit_id: bag,
      factor: "25",
      is_base: false,
    });
    const m = await rpc("save_move", {
      kind: "production",
      date: today,
      to_location: main,
      reason: "Bags",
      lines: [
        {
          product_id: p,
          unit_id: bag,
          quantity: "4",
          lot_number: "BAGS-" + randomUUID(),
          mfg_date: today,
        },
      ],
    });
    await rpc("post_move", m);
    assert.equal(
      (
        await db.query(
          "select sum(delta)::text q from erp_ledger where movement_id=$1",
          [m.id],
        )
      ).rows[0].q,
      "100.000000",
    );
    await failure(
      "save_conversion",
      { product_id: p, unit_id: bag, factor: "1", is_base: true },
      "P0001",
    );
    await failure(
      "save_conversion",
      { product_id: p, unit_id: kg, factor: "2", is_base: false },
      "23514",
    );
  },
);
tx(
  "ERP disabled and read-only modules deny backend work; disabling Quality never auto-releases stock",
  async () => {
    await db.query("delete from inspection_drafts");
    const s = await stock();
    await rpc("set_module", { module: "production", state: "read_only" });
    await failure(
      "save_move",
      {
        kind: "production",
        date: today,
        to_location: main,
        reason: "Blocked",
        lines: [
          {
            product_id: s.p,
            unit_id: kg,
            quantity: "1",
            lot_number: "BLOCKED",
            mfg_date: today,
          },
        ],
      },
      "P0001",
    );
    await rpc("set_module", { module: "quality", state: "disabled" });
    assert.equal(
      (await db.query("select qc_status from erp_lots where id=$1", [s.lot]))
        .rows[0].qc_status,
      "quarantine",
    );
    await rpc("release_lot", {
      id: s.lot,
      release: true,
      reason: "Warehouse manager release without QC",
    });
    await rpc("set_module", { module: "quality", state: "active" });
    assert.equal(
      (await db.query("select qc_status from erp_lots where id=$1", [s.lot]))
        .rows[0].qc_status,
      "quarantine",
    );
    await rpc("set_module", { module: "sales", state: "disabled" });
    await db.query("savepoint off_read");
    await assert.rejects(
      () => read("quotes"),
      (e) => (e as { code: string }).code === "42501",
    );
    await db.query("rollback to savepoint off_read");
  },
);
tx(
  "ERP stock and documents cannot be directly mutated by public or service roles",
  async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.query("savepoint role_check");
      await db.query("set local role " + role);
      await assert.rejects(
        () => db.query("select * from erp_lots"),
        (e) => (e as { code: string }).code === "42501",
      );
      await db.query("rollback to savepoint role_check");
      await db.query("savepoint role_check");
      await db.query("set local role " + role);
      await assert.rejects(
        () => db.query("select erp_get_lot('{}')"),
        (e) => (e as { code: string }).code === "42501",
      );
      await db.query("rollback to savepoint role_check");
    }
  },
);
tx(
  "ERP transfers roll back both legs when a destination is frozen",
  async () => {
    const s = await stock("10"),
      to = await rpc("save_location", {
        code: "TRANSFER-" + randomUUID().slice(0, 8),
        name: "Destination",
      }),
      count = await rpc("create_count", {
        location_id: to.id,
        scheduled_date: today,
        blind: true,
        reason: "Count",
      });
    await rpc("start_count", count);
    const m = await rpc("save_move", {
      kind: "transfer",
      date: today,
      from_location: main,
      to_location: to.id,
      reason: "Move stock",
      lines: [{ lot_id: s.lot, unit_id: kg, quantity: "2" }],
    });
    await failure("post_move", m, "P0001");
    assert.equal(
      (
        await db.query(
          "select quantity::text q from erp_balances where lot_id=$1 and location_id=$2",
          [s.lot, main],
        )
      ).rows[0].q,
      "10.000000",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from erp_ledger where movement_id=$1",
          [m.id],
        )
      ).rows[0].n,
      0,
    );
    await rpc("cancel_count", { ...count, reason: "Count postponed" });
    await rpc("post_move", m);
    assert.equal(
      (
        await db.query(
          "select sum(delta)::text q from erp_ledger where movement_id=$1",
          [m.id],
        )
      ).rows[0].q,
      "0.000000",
    );
    const rev = await rpc("reverse_move", {
      ...m,
      reason: "Wrong destination",
    });
    const record = (await read("movements", rev.id)).rows[0];
    assert.equal(record.snapshot.number, record.number);
    assert.equal(record.snapshot.from_location, "Destination");
  },
);
tx(
  "ERP stale draft review cannot post an edited movement or issue an edited quotation",
  async () => {
    const p = await product(),
      payload = {
        kind: "production",
        date: today,
        to_location: main,
        reason: "Review version",
        lines: [
          {
            product_id: p,
            unit_id: kg,
            quantity: "10",
            lot_number: "VERSION-" + randomUUID(),
            mfg_date: today,
          },
        ],
      };
    const m = await rpc("save_move", payload);
    await rpc("save_move", {
      ...payload,
      ...m,
      version: 1,
      reason: "Changed after review",
    });
    await failure("post_move", { id: m.id, version: 1 }, "P0001");
    await rpc("post_move", { id: m.id, version: 2 });
    const q = await quotation(p),
      row = (await read("quotes", q.id)).rows[0];
    await rpc("save_quote", {
      ...row,
      customer_id: row.customer_id,
      version: 1,
    });
    await failure("issue_quote", { id: q.id, version: 1 }, "P0001");
    await rpc("issue_quote", { id: q.id, version: 2 });
  },
);
tx(
  "ERP available lots are product-specific and ordered by expiry",
  async () => {
    const s = await stock();
    await release(s);
    const older = (await db.query("select (erp_today()-30)::text d")).rows[0].d,
      batch = "EARLY-" + randomUUID();
    const m = await rpc("save_move", {
      kind: "production",
      date: today,
      to_location: main,
      reason: "Earlier batch",
      lines: [
        {
          product_id: s.p,
          unit_id: kg,
          quantity: "5",
          lot_number: batch,
          mfg_date: older,
        },
      ],
    });
    await rpc("post_move", m);
    const early = (
      await db.query(
        "select id from erp_lots where product_id=$1 and number=$2",
        [s.p, batch],
      )
    ).rows[0].id;
    await release({ ...s, lot: early, batch });
    const available = await read("availability", s.p);
    assert.equal(available.total, 2);
    assert.equal(available.rows[0].lot_id, early);
    assert.ok(
      available.rows.every((r: { product_id: string }) => r.product_id === s.p),
    );
  },
);
tx(
  "ERP future inspections and expired stock are unavailable for reservation",
  async () => {
    const s = await stock(),
      spec = (
        await db.query("select id from spesifikasi where id_produk=$1", [s.p])
      ).rows[0].id,
      tomorrow = (await db.query("select (erp_today()+1)::text d")).rows[0].d;
    const h = await qc("create_uji", {
      id_produk: s.p,
      no_lot: s.batch,
      tgl_sampling: today,
      tgl_uji: tomorrow,
      inspector: "QA",
      catatan: "Future date",
      status: "PASS",
      hasil_detail: [{ spec_id: spec, p: "pH", val: "7", st: "PASS" }],
    });
    assert.equal(
      (await db.query("select qc_status from erp_lots where id=$1", [s.lot]))
        .rows[0].qc_status,
      "quarantine",
    );
    await qc("update_uji", {
      id: h.id,
      id_produk: s.p,
      no_lot: s.batch,
      tgl_sampling: today,
      tgl_uji: today,
      inspector: "QA",
      catatan: "Actual test",
      status: "PASS",
      hasil_detail: [{ spec_id: spec, p: "pH", val: "7", st: "PASS" }],
    });
    await db.query(
      "update erp_lots set mfg_date=(erp_today()-interval '1 year'-interval '2 days')::date,expiry_date=erp_today()-2 where id=$1",
      [s.lot],
    );
    assert.equal((await read("availability", s.p)).total, 0);
    const o = await order(s.p),
      line = (await read("orders", o.id)).rows[0].lines[0];
    await failure(
      "reserve",
      {
        order_line_id: line.id,
        lot_id: s.lot,
        location_id: main,
        quantity: "1",
      },
      "P0001",
    );
  },
);
test("ERP concurrent reservations never oversell physical stock", async () => {
  const s = await stock("100");
  await release(s);
  const a = await order(s.p, "80"),
    b = await order(s.p, "80");
  const la = (await read("orders", a.id)).rows[0].lines[0].id,
    lb = (await read("orders", b.id)).rows[0].lines[0].id;
  const clients = [
    new Client({ connectionString: url }),
    new Client({ connectionString: url }),
  ];
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const responses = await Promise.allSettled(
      clients.map((c, i) =>
        rpc(
          "reserve",
          {
            order_line_id: i ? lb : la,
            lot_id: s.lot,
            location_id: main,
            quantity: "80",
          },
          token,
          c,
        ),
      ),
    );
    assert.equal(responses.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await db.query("select erp_reserved($1,$2)::text q", [s.lot, main]))
        .rows[0].q,
      "80.000000",
    );
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});
