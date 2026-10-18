/** Disposable local database only. All fixtures and DDL roll back. Never targets production. */
import { Client } from "pg";
async function main() {
  const db = new Client({
    connectionString:
      "postgres://postgres:local-test-only@127.0.0.1:55432/postgres",
  });
  await db.connect();
  await db.query("begin");
  try {
    const definition = (
      await db.query(
        "select pg_get_indexdef('search_master_produk_nama_produk'::regclass) sql",
      )
    ).rows[0].sql;
    await db.query("drop index search_master_produk_nama_produk");
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) select 'PERF-'||i,'PERF-SELECTIVE-'||i,'Performance fixture','kg','Halal','Bag' from generate_series(1,20000) i",
    );
    await db.query("analyze master_produk");
    async function measure() {
      const runs = [];
      let plan;
      for (let i = 0; i < 7; i++) {
        const r = (
          await db.query(
            "explain (analyze,buffers,format json) select id from master_produk where nama_produk ilike '%PERF-SELECTIVE-19999%'",
          )
        ).rows[0]["QUERY PLAN"][0];
        runs.push(r["Execution Time"]);
        plan = r.Plan;
      }
      runs.sort((a, b) => a - b);
      return { medianExecutionMs: runs[3], plan };
    }
    const before = await measure();
    await db.query(definition);
    await db.query("analyze master_produk");
    const after = await measure();
    process.stdout.write(
      JSON.stringify({ fixtureRows: 20000, runs: 7, before, after }, null, 2) +
        "\n",
    );
  } finally {
    await db.query("rollback");
    await db.query("analyze master_produk");
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
