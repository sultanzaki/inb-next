import { readFile } from "node:fs/promises";
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

// Release behavior runs against the forward migration after the original 004 regression cases.
test("release migration applies and repeats without renumbering historical lots", async () => {
  const sql = await readFile(
    new URL(
      "../src/lib/db/migrations/005_release_operations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
});
async function autoStock(p?: string, date = today, quantity = "100") {
  p = p || (await product());
  if (
    !(await db.query("select from erp_product_series where product_id=$1", [p]))
      .rowCount
  )
    await rpc("set_series", {
      product_id: p,
      series: "00" + String(Math.floor(Math.random() * 1e12)),
    });
  const m = await rpc("save_move", {
    kind: "production",
    date: today,
    to_location: main,
    reason: "Release production",
    lines: [{ product_id: p, unit_id: kg, quantity, mfg_date: date }],
  });
  const draft = (await read("production", m.id)).rows[0];
  assert.match(draft.lines[0].lot, /^DRAFT-/);
  await rpc("post_move", { id: m.id, version: draft.version });
  const line = (await read("production", m.id)).rows[0].lines[0];
  return { p, batch: line.lot, m, lot: line.lot_id };
}
tx(
  "release production allocates yearly product batches, preserves zeros, locks identity and never reuses reversed numbers",
  async () => {
    const p = await product();
    await rpc("set_series", { product_id: p, series: "01" });
    const a = await autoStock(p, "2025-10-18"),
      b = await autoStock(p, "2025-10-18"),
      c = await autoStock(p, "2026-01-01");
    assert.equal(a.batch, "01.01.18102025.2026");
    assert.equal(b.batch, "01.02.18102025.2026");
    assert.equal(c.batch, "01.01.01012026.2027");
    await rpc("post_move", a.m);
    assert.equal(
      (
        await db.query(
          "select batch from erp_batch_counters where product_id=$1 and year=2025",
          [p],
        )
      ).rows[0].batch,
      2,
    );
    await failure("set_series", { product_id: p, series: "02" });
    await rpc("reverse_move", { id: b.m.id, reason: "Correct output" });
    assert.equal(
      (await autoStock(p, "2025-10-18")).batch,
      "01.03.18102025.2026",
    );
    await db.query("savepoint identity_lock");
    await assert.rejects(() =>
      db.query("update erp_lots set number='changed' where id=$1", [a.lot]),
    );
    await db.query("rollback to savepoint identity_lock");
    await db.query(
      "update erp_batch_counters set batch=99 where product_id=$1 and year=2025",
      [p],
    );
    assert.equal(
      (await autoStock(p, "2025-10-18")).batch,
      "01.100.18102025.2026",
    );
  },
);
tx(
  "release production rejects missing/duplicate series and stale posts without consuming a batch",
  async () => {
    const p = await product(),
      p2 = await product();
    await rpc("set_series", { product_id: p, series: "200" });
    await failure("set_series", { product_id: p2, series: "200" }, "23505");
    const m = await rpc("save_move", {
      kind: "production",
      date: today,
      to_location: main,
      reason: "Unconfigured",
      lines: [{ product_id: p2, unit_id: kg, quantity: "10", mfg_date: today }],
    });
    await failure("post_move", m);
    assert.equal(
      (
        await db.query("select from erp_batch_counters where product_id=$1", [
          p2,
        ])
      ).rowCount,
      0,
    );
  },
);
tx(
  "release inspections select received lots, reject manual identities and pre-manufacturing dates, retain standalone QC",
  async () => {
    const s = await autoStock();
    await release(s);
    const spec = (
      await db.query("select id from spesifikasi where id_produk=$1", [s.p])
    ).rows[0].id;
    const payload = {
      id_produk: s.p,
      no_lot: "MANUAL",
      tgl_sampling: today,
      tgl_uji: today,
      inspector: "QA",
      catatan: "",
      failure_reason: "",
      hasil_detail: [{ spec_id: spec, p: "pH", val: "7", st: "PASS" }],
      status: "PASS",
    };
    await db.query("savepoint manual");
    await assert.rejects(() => qc("create_uji", payload));
    await db.query("rollback to savepoint manual");
    await rpc("set_module", { module: "production", state: "disabled" });
    await qc("create_uji", payload);
  },
);
tx(
  "release hold blocks allocations and keeps a PASS lot quarantined until approved hold removal",
  async () => {
    const s = await autoStock();
    await release(s);
    await rpc("hold_lot", {
      id: s.lot,
      hold: true,
      reason: "Investigate complaint",
    });
    const o = await order(s.p);
    await failure("reserve", {
      order_line_id: (await read("orders", o.id)).rows[0].lines[0].id,
      lot_id: s.lot,
      location_id: main,
      quantity: "1",
    });
    assert.equal(
      (await db.query("select qc_status from erp_lots where id=$1", [s.lot]))
        .rows[0].qc_status,
      "quarantine",
    );
    await rpc("hold_lot", {
      id: s.lot,
      hold: false,
      reason: "Investigation cleared",
    });
    await reserve(o, s.lot, "1");
    const trace = await read("trace", s.lot);
    assert.equal(trace.inspection.status, "PASS");
    assert.equal(trace.stock[0].reserved, "1.000000");
  },
);
async function shipped() {
  const s = await autoStock();
  const h = await release(s);
  await certificate(h);
  const o = await order(s.p, "20"),
    r = await reserve(o, s.lot, "20");
  const m = await rpc("create_delivery", {
    order_id: o.id,
    date: today,
    reason: "Shipment",
    lines: [{ reservation_id: r.id, quantity: "10" }],
  });
  await rpc("post_move", m);
  return { ...s, delivery: m.id };
}
tx(
  "release returns are capped, received once into held stock, cannot bypass disposition and scrap through immutable ledger",
  async () => {
    const s = await shipped();
    await failure("create_return", {
      delivery_id: s.delivery,
      lot_id: s.lot,
      location_id: main,
      quantity: "11",
      reason: "Damaged",
    });
    const ret = await rpc("create_return", {
      delivery_id: s.delivery,
      lot_id: s.lot,
      location_id: main,
      quantity: "5",
      reason: "Damaged bag",
    });
    await rpc("receive_return", { id: ret.id, reason: "Physical receipt" });
    await rpc("receive_return", { id: ret.id, reason: "Retry receipt" });
    const row = (await read("returns", ret.id)).rows[0];
    assert.equal(row.state, "received");
    const returned = (
      await db.query("select * from erp_lots where id=$1", [row.lot_id])
    ).rows[0];
    assert.equal(returned.held, true);
    assert.equal(returned.source_lot_id, s.lot);
    const bypass = await rpc("save_move", {
      kind: "issue",
      date: today,
      from_location: main,
      reason: "Unapproved return issue",
      lines: [{ lot_id: row.lot_id, unit_id: kg, quantity: "1" }],
    });
    await failure("post_move", bypass);
    await failure("reverse_move", {
      id: row.receipt_id,
      reason: "Unapproved receipt correction",
    });
    await failure("hold_lot", {
      id: row.lot_id,
      hold: false,
      reason: "Bypass",
    });
    await failure("dispose_return", {
      id: ret.id,
      decision: "release",
      reason: "No reinspection",
    });
    await failure("reverse_move", {
      id: s.delivery,
      reason: "Incorrect reversal",
    });
    await rpc("dispose_return", {
      id: ret.id,
      decision: "scrap",
      reason: "Approved disposal",
    });
    assert.equal((await read("returns", ret.id)).rows[0].state, "scrapped");
    assert.equal(
      (
        await db.query(
          "select quantity::text q from erp_balances where lot_id=$1",
          [row.lot_id],
        )
      ).rows[0].q,
      "0.000000",
    );
  },
);
tx(
  "release returned goods need fresh valid QC before release; returns do not rewrite delivered sales quantities",
  async () => {
    const s = await shipped(),
      ret = await rpc("create_return", {
        delivery_id: s.delivery,
        lot_id: s.lot,
        location_id: main,
        quantity: "3",
        reason: "Packaging check",
      });
    await rpc("receive_return", { id: ret.id, reason: "Received" });
    let row = (await read("returns", ret.id)).rows[0];
    const l = (
      await db.query("select number from erp_lots where id=$1", [row.lot_id])
    ).rows[0];
    await release({ ...s, lot: row.lot_id, batch: l.number });
    assert.equal(
      (
        await db.query("select qc_status from erp_lots where id=$1", [
          row.lot_id,
        ])
      ).rows[0].qc_status,
      "quarantine",
    );
    await rpc("dispose_return", {
      id: ret.id,
      decision: "release",
      reason: "QC passed",
    });
    row = (await read("returns", ret.id)).rows[0];
    assert.equal(row.state, "released");
    assert.equal(
      (
        await db.query("select qc_status from erp_lots where id=$1", [
          row.lot_id,
        ])
      ).rows[0].qc_status,
      "released",
    );
  },
);
tx(
  "release inbox assignment and analytics respect permissions and module modes",
  async () => {
    const s = await autoStock();
    let inbox = await read("inbox");
    const task = inbox.rows.find((r: { id: string }) => r.id === "qc:" + s.lot);
    assert.ok(task);
    await rpc("set_access", {
      user_id: operatorId,
      module: "quality",
      read: true,
      write: true,
      approve: false,
    });
    await rpc("assign_task", {
      task_id: task.id,
      user_id: operatorId,
      due_date: today,
    });
    inbox = await read("inbox");
    assert.equal(
      inbox.rows.find((r: { id: string }) => r.id === task.id).assigned_to,
      operatorId,
    );
    await release(s);
    assert.ok(
      !(await read("inbox")).rows.some((r: { id: string }) => r.id === task.id),
    );
    await rpc("set_access", {
      user_id: operatorId,
      module: "quality",
      read: false,
      write: false,
      approve: false,
    });
    assert.ok(
      !(await read("inbox", undefined, operator)).rows.some(
        (r: { module: string }) => r.module === "quality",
      ),
    );
    await db.query("savepoint denied");
    await assert.rejects(() =>
      db.query("select erp_read($1,'overview','30','quality')", [operator]),
    );
    await db.query("rollback to savepoint denied");
    const overview = (
      await db.query("select erp_read($1,'overview','7','production') r", [
        token,
      ])
    ).rows[0].r;
    assert.equal(overview.series.length, 7);
    assert.equal(overview.chart_label, "Posted production records");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.query("savepoint direct");
      await db.query(`set local role ${role}`);
      await assert.rejects(() => db.query("select * from erp_returns"));
      await db.query("rollback to savepoint direct");
    }
  },
);
test("release concurrent production posting allocates distinct batches atomically", async () => {
  const p = await product();
  await rpc("set_series", {
    product_id: p,
    series: "009" + String(Math.floor(Math.random() * 1e10)),
  });
  const drafts = [];
  for (let i = 0; i < 2; i++)
    drafts.push(
      await rpc("save_move", {
        kind: "production",
        date: today,
        to_location: main,
        reason: "Concurrent output",
        lines: [{ product_id: p, unit_id: kg, quantity: "1", mfg_date: today }],
      }),
    );
  const other = new Client({ connectionString: url });
  await other.connect();
  try {
    await Promise.all(
      drafts.map((m, i) => rpc("post_move", m, token, i ? other : db)),
    );
  } finally {
    await other.end();
  }
  const lots = (
    await db.query(
      "select batch_number from erp_lots where product_id=$1 and batch_number is not null order by batch_number",
      [p],
    )
  ).rows;
  assert.deepEqual(
    lots.map((r) => r.batch_number),
    [1, 2],
  );
});

tx(
  "release series setup adopts historical batch counters across dates without renaming lots",
  async () => {
    const p = await product();
    await db.query(
      "insert into erp_lots(product_id,number,mfg_date,expiry_date) values($1,'333.07.01012026.2027','2026-01-01','2027-01-01')",
      [p],
    );
    await rpc("set_series", { product_id: p, series: "333" });
    const s = await autoStock(p, "2026-02-01");
    assert.equal(s.batch, "333.08.01022026.2027");
    assert.equal(
      (
        await db.query(
          "select number from erp_lots where product_id=$1 and batch_number is null",
          [p],
        )
      ).rows[0].number,
      "333.07.01012026.2027",
    );
  },
);

tx(
  "release posting a legacy draft never renames an already stocked lot",
  async () => {
    const p = await product(),
      batch = "LEGACY-" + randomUUID();
    const payload = {
      kind: "production",
      date: today,
      to_location: main,
      reason: "Legacy draft",
      lines: [
        {
          product_id: p,
          unit_id: kg,
          quantity: "5",
          lot_number: batch,
          mfg_date: today,
        },
      ],
    };
    // Simulate a 004 draft saved against a lot with physical history, then upgrade its posting.
    const receipt = await rpc("save_move", { ...payload, kind: "receipt" });
    await rpc("post_move", receipt);
    const legacy = (
      await db.query("select erp_mutate_v4($1,'save_move',$2) r", [
        token,
        JSON.stringify(payload),
      ])
    ).rows[0].r;
    await rpc("set_series", { product_id: p, series: "444" });
    await rpc("post_move", legacy);
    const lots = (
      await db.query(
        "select number,batch_number from erp_lots where product_id=$1 order by batch_number nulls first",
        [p],
      )
    ).rows;
    assert.equal(lots[0].number, batch);
    assert.equal(lots[1].batch_number, 1);
    const draft = await rpc("save_move", payload),
      draftLot = (await read("production", draft.id)).rows[0].lines[0].lot_id;
    assert.equal((await read("lots", draftLot)).total, 0);
  },
);
