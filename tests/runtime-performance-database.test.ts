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
  const sql = await readFile(
    new URL(
      "../src/lib/db/migrations/008_performance_routes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  await db.query(sql);
});
after(() => db.end());
async function account(role = "quality_officer") {
  const id = (
    await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,'private-test-hash',$2,'Performance fixture') returning id",
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
async function rpc(name: string, token: string, ...args: unknown[]) {
  return (
    await db.query(
      `select ${name}(${[token, ...args].map((_, i) => "$" + (i + 1)).join(",")}) r`,
      [token, ...args],
    )
  ).rows[0].r;
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
tx(
  "session RPC returns safe effective identity and immediately respects expiry/deactivation",
  async () => {
    const { id, token } = await account();
    const u = await rpc("qc_session_user", token);
    assert.equal(u.id, id);
    assert.ok(u.effective_actions.includes("save_draft"));
    assert.ok(!u.effective_actions.includes("issue_coa"));
    assert.doesNotMatch(
      JSON.stringify(u),
      /private-test-hash|password_hash|expires_at|token/,
    );
    await db.query(
      "update sessions set expires_at=now()-interval '1 second' where token=$1",
      [token],
    );
    assert.equal(await rpc("qc_session_user", token), null);
    await db.query(
      "update sessions set expires_at=now()+interval '1 hour' where token=$1",
      [token],
    );
    await db.query("update users set is_active=false where id=$1", [id]);
    assert.equal(await rpc("qc_session_user", token), null);
  },
);
tx(
  "forced password identity is readable but receives no operational actions",
  async () => {
    const { id, token } = await account();
    await db.query("update users set must_change_password=true where id=$1", [
      id,
    ]);
    const u = await rpc("qc_session_user", token);
    assert.equal(u.must_change_password, true);
    assert.deepEqual(u.effective_actions, []);
  },
);
tx(
  "aggregate analytics matches exact period counts and six contiguous buckets",
  async () => {
    const { token } = await account();
    for (const period of [30, 90]) {
      const r = await rpc("qc_quality_analytics", token, period);
      assert.equal(r.buckets.length, 6);
      const expected = (
        await db.query(
          "select count(*) filter(where status='PASS')::int passed,count(*) filter(where status='FAIL')::int failed from hasil_uji where tgl_uji between $1 and $2",
          [r.from, r.to],
        )
      ).rows[0];
      assert.equal(
        r.buckets.reduce((n: number, b: { passed: number }) => n + b.passed, 0),
        expected.passed,
      );
      assert.equal(
        r.buckets.reduce((n: number, b: { failed: number }) => n + b.failed, 0),
        expected.failed,
      );
      assert.equal(r.buckets[0].from, r.from);
      assert.equal(r.buckets[5].to, r.to);
      assert.equal(r.documents, undefined);
    }
  },
);
tx(
  "summary matches database totals and sends at most eight lightweight inspection records",
  async () => {
    const { token } = await account();
    const r = await rpc("qc_quality_summary", token);
    const expected = (
      await db.query(
        "select count(*)::int total,count(*) filter(where status='PASS')::int passed,count(*) filter(where status='FAIL')::int failed from hasil_uji",
      )
    ).rows[0];
    assert.equal(r.total_lot, expected.total);
    assert.equal(r.lot_pass, expected.passed);
    assert.equal(r.lot_fail, expected.failed);
    assert.ok(r.recent_inspeksi.length <= 8);
    assert.ok(r.recent_inspeksi.every((x: object) => !("hasil_detail" in x)));
    assert.equal(r.dok_berlaku, undefined);
  },
);
tx("quality RPCs cannot bypass module permissions", async () => {
  const { token } = await account("sales_officer");
  for (const fn of ["qc_quality_summary", "qc_quality_analytics"]) {
    await db.query("savepoint denied");
    await assert.rejects(
      () => rpc(fn, token),
      (e: unknown) => (e as { code: string }).code === "42501",
    );
    await db.query("rollback to denied");
  }
});
tx(
  "global search treats wildcard characters literally and respects module scope",
  async () => {
    await db.query("update erp_modules set state='active'");
    const { token } = await account("viewer");
    const name = "Search%_literal-" + randomUUID();
    const p = (
      await db.query(
        "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,$1,'Test','kg','Halal','Bag') returning id",
        [name],
      )
    ).rows[0];
    await db.query("insert into erp_lots(product_id,number) values($1,$2)", [
      p.id,
      name,
    ]);
    const hits = await rpc("qc_global_search", token, "Search%_literal");
    assert.ok(
      hits.some(
        (h: { type: string; title: string }) =>
          h.type === "Products" && h.title === name,
      ),
    );
    assert.ok(hits.every((h: { type: string }) => h.type !== "Lots"));
    assert.deepEqual(await rpc("qc_global_search", token, "x"), []);
    assert.ok(hits.every((h: { path: string }) => !h.path.includes("produk")));
  },
);
tx(
  "new RPCs are private to service role and invalid sessions disclose no data",
  async () => {
    for (const signature of [
      "qc_session_user(text)",
      "qc_quality_summary(text)",
      "qc_quality_analytics(text,integer)",
      "qc_global_search(text,text)",
    ]) {
      for (const role of ["anon", "authenticated"])
        assert.equal(
          (
            await db.query(
              "select has_function_privilege($1,$2,'execute') ok",
              [role, signature],
            )
          ).rows[0].ok,
          false,
        );
      assert.equal(
        (
          await db.query(
            "select has_function_privilege('service_role',$1,'execute') ok",
            [signature],
          )
        ).rows[0].ok,
        true,
      );
    }
    assert.equal(await rpc("qc_session_user", randomUUID()), null);
  },
);
