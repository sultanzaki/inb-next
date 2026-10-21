import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTableQuery, fieldValue } from "../src/lib/tables/schema";
import { tableParameters, queryTypes } from "../src/lib/tables/postgrest";
test("table schema validates fields, dates, numeric types and sort priorities", () => {
  for (const query of [
    { filters: [{ field: "password_hash", op: "contains", value: "x" }] },
    { filters: [{ field: "amount", op: "gte", value: "1.234,00" }] },
    { filters: [{ field: "date", op: "eq", value: "2026-02-30" }] },
    {
      sorts: [
        { field: "amount", direction: "asc" },
        { field: "amount", direction: "desc" },
      ],
    },
  ])
    assert.throws(() =>
      parseTableQuery(JSON.stringify(query), "fin_documents"),
    );
  const query = parseTableQuery(
    JSON.stringify({
      filters: [{ field: "amount", op: "gte", value: "1234.50" }],
      sorts: [{ field: "amount", direction: "desc" }],
    }),
    "fin_documents",
  );
  assert.equal(queryTypes("fin_documents", query).sorts[0].type, "number");
  assert.equal(
    fieldValue({ totals: { total: "100.25" } }, "totals.total"),
    "100.25",
  );
});
test("literal text filters escape regex metacharacters and keep independent conditions", () => {
  const query = parseTableQuery(
    JSON.stringify({
      filters: [
        { field: "nama_produk", op: "contains", value: "a.* (b), 100%_" },
        { field: "nama_produk", op: "neq", value: "other" },
      ],
      sorts: [{ field: "nama_produk", direction: "asc" }],
    }),
    "master_produk",
  );
  const p = tableParameters("master_produk", query);
  assert.deepEqual(p.getAll("nama_produk"), [
    "imatch.a\\.\\* \\(b\\), 100%_",
    "neq.other",
  ]);
  assert.equal(p.get("order"), "nama_produk.asc.nullslast,id.asc");
});

test("certificate product identity uses the signed snapshot after master data changes", () => {
  assert.equal(
    fieldValue(
      {
        hasil_uji_snapshot: { produk: "Original product" },
        master_produk: { nama_produk: "Renamed product" },
      },
      "product_name",
    ),
    "Original product",
  );
  assert.equal(
    fieldValue(
      { master_produk: { nama_produk: "Current product" } },
      "product_name",
    ),
    "Current product",
  );
});
