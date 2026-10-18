import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
let admin: string, today: string, kg: string, main: string;
async function account(role: string) {
  const id = (
    await db.query(
      "insert into users(username,password_hash,nama_lengkap,role) values($1,'fixture',$2,$3) returning id",
      [randomUUID(), role + " fixture", role],
    )
  ).rows[0].id;
  return { id, token: await session(id) };
}
async function session(id: string) {
  const token = randomUUID();
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [id, token],
  );
  return token;
}
async function rpc(action: string, payload: unknown, token = admin) {
  return (
    await db.query("select erp_mutate($1,$2,$3) r", [
      token,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].r;
}
async function read(
  entity: string,
  token = admin,
  q = "",
  state = "",
  id?: string,
) {
  return (
    await db.query("select erp_read($1,$2,$3,$4,1,$5) r", [
      token,
      entity,
      q,
      state,
      id ?? null,
    ])
  ).rows[0].r;
}
async function rejected(run: () => Promise<unknown>, code?: string) {
  await db.query("savepoint denied");
  try {
    await assert.rejects(
      run,
      (e: unknown) => !code || (e as { code: string }).code === code,
    );
  } finally {
    await db.query("rollback to denied");
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
      "../src/lib/db/migrations/007_release_access_insights.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
  admin = (await account("admin qc")).token;
  today = (await db.query("select erp_today()::text t")).rows[0].t;
  kg = (await db.query("select id from erp_units where code='kg'")).rows[0].id;
  main = (await db.query("select id from erp_locations where code='MAIN'"))
    .rows[0].id;
});
after(() => db.end());
tx(
  "role defaults grant operational access without granting administration",
  async () => {
    for (const [role, module, write, approve] of [
      ["quality_officer", "quality", true, false],
      ["quality_manager", "quality", true, true],
      ["warehouse_operator", "warehouse", true, false],
      ["warehouse_manager", "warehouse", true, true],
      ["production_operator", "production", true, false],
      ["purchasing_officer", "purchase", true, false],
      ["purchasing_manager", "purchase", true, true],
      ["sales_officer", "sales", true, false],
      ["sales_manager", "sales", true, true],
    ] as const) {
      const u = await account(role);
      const r = (await read("context", u.token)).modules.find(
        (m: { key: string }) => m.key === module,
      );
      assert.equal(r.read, true);
      assert.equal(r.write, write);
      assert.equal(r.approve, approve);
      const actions = (
        await db.query("select erp_permissions($1) r", [u.token])
      ).rows[0].r;
      assert.ok(!actions.includes("manage_users"));
      await rejected(() => read("access", u.token));
    }
  },
);
tx(
  "explicit denies override role defaults; permission changes revoke sessions; restoring removes the exception",
  async () => {
    const u = await account("sales_manager");
    await rpc("set_access", {
      user_id: u.id,
      module: "sales",
      read: true,
      write: false,
      approve: false,
    });
    await rejected(() => read("context", u.token));
    u.token = await session(u.id);
    const sales = (await read("context", u.token)).modules.find(
      (m: { key: string }) => m.key === "sales",
    );
    assert.equal(sales.write, false);
    assert.equal(sales.approve, false);
    await rpc("reset_access", { user_id: u.id, module: "sales" });
    await rejected(() => read("context", u.token));
    u.token = await session(u.id);
    assert.equal(
      (await read("context", u.token)).modules.find(
        (m: { key: string }) => m.key === "sales",
      ).approve,
      true,
    );
  },
);
tx(
  "changing role clears exceptions and immediately invalidates prior sessions",
  async () => {
    const u = await account("warehouse_operator");
    await rpc("set_access", {
      user_id: u.id,
      module: "sales",
      read: true,
      write: true,
      approve: false,
    });
    u.token = await session(u.id);
    await db.query("update users set role='production_operator' where id=$1", [
      u.id,
    ]);
    await rejected(() => read("context", u.token));
    assert.equal(
      (
        await db.query("select count(*) n from erp_access where user_id=$1", [
          u.id,
        ])
      ).rows[0].n,
      "0",
    );
    u.token = await session(u.id);
    assert.equal(
      (await read("context", u.token)).modules.find(
        (m: { key: string }) => m.key === "sales",
      ).read,
      false,
    );
  },
);
tx(
  "quality officers can save inspection drafts but cannot certify or edit specifications",
  async () => {
    const u = await account("quality_officer");
    const draft = (
      await db.query("select qc_mutate($1,'save_draft',$2) r", [
        u.token,
        JSON.stringify({ data: {} }),
      ])
    ).rows[0].r;
    assert.ok(draft.id);
    for (const action of ["issue_coa", "create_produk", "delete_uji"]) {
      await rejected(() =>
        db.query("select qc_mutate($1,$2,'{}')", [u.token, action]),
      );
    }
    const actions = (await db.query("select erp_permissions($1) r", [u.token]))
      .rows[0].r;
    assert.ok(actions.includes("create_uji"));
    assert.ok(!actions.includes("issue_coa"));
  },
);
tx(
  "read-only module mode denies QC and commercial writes independently of role",
  async () => {
    const u = await account("quality_manager");
    await rpc("set_module", { module: "quality", state: "read_only" });
    const actions = (await db.query("select erp_permissions($1) r", [u.token]))
      .rows[0].r;
    assert.ok(!actions.includes("issue_coa"));
    await rejected(() =>
      db.query("select qc_mutate($1,'save_draft','{}')", [u.token]),
    );
  },
);
tx(
  "warehouse receivers can receive purchase lots without editing or approving purchase orders",
  async () => {
    const u = await account("warehouse_operator");
    const supplier = await rpc("save_supplier", {
        name: "Supplier",
        active: true,
      }),
      mat = await rpc("save_material", {
        code: randomUUID(),
        name: "Stearic",
        unit_id: kg,
        minimum_stock: "0",
        active: true,
      });
    const po = await rpc("save_purchase", {
      supplier_id: supplier.id,
      date: today,
      expected_date: today,
      currency: "IDR",
      terms: "",
      lines: [{ material_id: mat.id, quantity: "10", price: "10" }],
    });
    await rpc("confirm_purchase", { id: po.id, version: 1 });
    const record = (await read("purchases", admin, "", "", po.id)).rows[0];
    await rpc(
      "receive_purchase",
      {
        id: po.id,
        version: record.version,
        request_key: randomUUID(),
        date: today,
        location_id: main,
        reason: "Delivery",
        lines: [
          {
            line_id: record.lines[0].id,
            lot_number: "SUP-001",
            quantity: "10",
            expiry_date: "",
          },
        ],
      },
      u.token,
    );
    await rejected(() => rpc("save_purchase", {}, u.token));
    await rejected(() =>
      rpc("confirm_purchase", { id: po.id, version: 1 }, u.token),
    );
  },
);
tx(
  "operational insights are permission-scoped and preserve daily periods",
  async () => {
    const u = await account("purchasing_officer");
    const r = await read("insights", u.token, "7", "purchase");
    assert.equal(r.series.length, 7);
    assert.ok(
      r.attention.some(
        (a: { label: string }) => a.label === "Materials below minimum",
      ),
    );
    await rejected(() => read("insights", u.token, "7", "crm"));
    await rejected(() => read("role_access", u.token, "sales_manager"));
    const matrix = await read("role_access", admin, "sales_officer");
    assert.equal(
      matrix.rows.find((r: { id: string }) => r.id === "sales").can_approve,
      false,
    );
  },
);
tx(
  "new RBAC helpers and role tables cannot be used directly by browser roles",
  async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        (
          await db.query(
            "select has_table_privilege($1,'erp_role_permissions','UPDATE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'erp_mutate_v7(text,text,jsonb)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    }
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role','erp_permissions(text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      true,
    );
  },
);

tx(
  "quality managers can maintain specifications through the guarded QC evaluator",
  async () => {
    const u = await account("quality_manager");
    const payload = {
      kode_produk: randomUUID(),
      nama_produk: "INDOSTER 01",
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
    };
    const r = (
      await db.query("select qc_mutate($1,'create_produk',$2) r", [
        u.token,
        JSON.stringify(payload),
      ])
    ).rows[0].r;
    assert.ok(r.id);
  },
);
