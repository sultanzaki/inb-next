import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { entityColumns } from "../src/lib/tables/schema";
const db = new Client({
  connectionString:
    "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
});
before(async () => {
  await db.connect();
  const sql = await readFile(
    new URL(
      "../src/lib/db/migrations/017_advanced_tables.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
});
after(() => db.end());
async function fixture() {
  const token = randomUUID();
  const uid = (
    await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'test','administrator inbionusa','Table test') returning id",
      [randomUUID()],
    )
  ).rows[0].id;
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [uid, token],
  );
  await db.query("update erp_modules set state='active'");
  return token;
}
async function read(
  token: string,
  entity: string,
  query: unknown = {},
  page = 1,
) {
  return (
    await db.query("select erp_table_read($1,$2,$3,'','',$4) data", [
      token,
      entity,
      query,
      page,
    ])
  ).rows[0].data;
}
test("advanced reads preserve authorized collection totals and row identities", async () => {
  await db.query("begin");
  try {
    const token = await fixture();
    for (const entity of Object.keys(entityColumns).filter(
      (e) =>
        ![
          "master_produk",
          "hasil_uji",
          "coa",
          "audit_log",
          "users",
          "series",
        ].includes(e),
    )) {
      const legacy = (
        await db.query("select erp_read($1,$2) data", [token, entity])
      ).rows[0].data;
      const enhanced = await read(token, entity);
      assert.equal(enhanced.total, legacy.total, entity);
      assert.equal(enhanced.rows.length, legacy.rows.length, entity);
    }
  } finally {
    await db.query("rollback");
  }
});
test("filters and multi-sort run across all rows before pagination with deterministic ties", async () => {
  await db.query("begin");
  try {
    const token = await fixture();
    const prefix = "TABLE-" + randomUUID().slice(0, 8);
    for (let i = 0; i < 105; i++)
      await db.query("insert into erp_units(code,name) values($1,$2)", [
        prefix + String(i).padStart(3, "0"),
        "Table fixture " + (i % 2),
      ]);
    const query = {
      filters: [{ field: "code", op: "starts", value: prefix }],
      sorts: [
        { field: "name", direction: "asc" },
        { field: "code", direction: "desc" },
      ],
    };
    const first = await read(token, "units", query);
    const second = await read(token, "units", query, 2);
    assert.equal(first.total, 105);
    assert.equal(first.rows.length, 50);
    assert.equal(second.rows.length, 50);
    assert.equal(first.rows[0].code, prefix + "104");
    assert.equal(
      new Set(
        [...first.rows, ...second.rows].map(
          (r: Record<string, unknown>) => r.id,
        ),
      ).size,
      100,
    );
    const filtered = await read(token, "units", {
      ...query,
      filters: [
        ...query.filters,
        { field: "name", op: "eq", value: "Table fixture 1" },
      ],
    });
    assert.equal(filtered.total, 52);
    assert.ok(
      filtered.rows.every(
        (r: Record<string, unknown>) => r.name === "Table fixture 1",
      ),
    );
  } finally {
    await db.query("rollback");
  }
});
test("numeric sorting, empty values and date filters keep their types", async () => {
  await db.query("begin");
  try {
    await db.query("select set_config('app.table_query',$1,true)", [
      JSON.stringify({
        sorts: [{ field: "amount", direction: "asc", type: "number" }],
        filters: [
          { field: "date", op: "eq", value: "2026-10-21", type: "date" },
        ],
      }),
    ]);
    const data = (
      await db.query("select erp_table_source($1,'test','','',1,null) data", [
        "select * from (values ('a','100','2026-10-21T12:00:00Z'),('b','9','2026-10-21T03:00:00Z'),('c','1','2026-10-20')) t(id,amount,date)",
      ])
    ).rows[0].data;
    assert.deepEqual(
      data.rows.map((r: Record<string, unknown>) => r.amount),
      ["9", "100"],
    );
    assert.equal(data.total, 2);
  } finally {
    await db.query("rollback");
  }
});
test("table reads do not weaken module access or expose helper SQL RPCs", async () => {
  await db.query("begin");
  try {
    const token = await fixture();
    await db.query(
      "update erp_modules set state='disabled' where key='finance'",
    );
    await assert.rejects(read(token, "fin_documents"), { code: "42501" });
  } finally {
    await db.query("rollback");
  }
  const checks = (
    await db.query(
      "select has_function_privilege('anon','public.erp_table_read(text,text,jsonb,text,text,integer,text)','execute') exposed,has_function_privilege('service_role','public.erp_table_source(text,text,text,text,integer,text,text)','execute') helper",
    )
  ).rows[0];
  assert.equal(checks.exposed, false);
  assert.equal(checks.helper, false);
});

test("filtered totals never combine currencies or units", async () => {
  await db.query("begin");
  try {
    await db.query("select set_config('app.table_query',$1,true)", [
      JSON.stringify({
        filters: [{ field: "amount", op: "gte", value: "2", type: "number" }],
        summary: ["amount"],
      }),
    ]);
    const data = (
      await db.query("select erp_table_source($1,'test','','',1,null) data", [
        "select * from (values ('a','100','IDR'),('b','9','USD'),('c','1','IDR'),('d','5','USD')) t(id,amount,currency)",
      ])
    ).rows[0].data;
    assert.deepEqual(data.summary, [
      { field: "amount", unit: "IDR", total: "100" },
      { field: "amount", unit: "USD", total: "14" },
    ]);
  } finally {
    await db.query("rollback");
  }
});
