import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessDate,
  parseNumber,
  evaluateParam,
  productSchema,
  inspectionSchema,
  documentSchema,
  issueSchema,
} from "../src/lib/domain/validation";
import { canAction } from "../src/lib/types";
import { dataUrl } from "../src/lib/data-access";

test("strict finite numeric parsing including Indonesian decimals", () => {
  for (const s of ["", "12abc", "0x10", "Infinity", "1,2,3", "1e9999"])
    assert.equal(parseNumber(s), null, s);
  assert.equal(parseNumber("1,5"), 1.5);
  assert.equal(parseNumber(" -2.5e2 "), -250);
  assert.equal(
    evaluateParam(
      { tipe_batas: "MAX", nilai_min: "", nilai_maks: "1,2" },
      "1,5",
    ),
    "FAIL",
  );
  assert.equal(
    evaluateParam({ tipe_batas: "MIN", nilai_min: "2", nilai_maks: "" }, "2"),
    "PASS",
  );
  assert.equal(
    evaluateParam({ tipe_batas: "RANGE", nilai_min: "", nilai_maks: "" }, "2"),
    "FAIL",
  );
});
test("business date uses Jakarta on both sides of UTC midnight", () => {
  assert.equal(businessDate(new Date("2026-10-15T18:00:00Z")), "2026-10-16");
  assert.equal(businessDate(new Date("2026-10-15T16:59:00Z")), "2026-10-15");
});
test("malformed payloads fail validation rather than throwing", () => {
  for (const schema of [
    productSchema,
    inspectionSchema,
    documentSchema,
    issueSchema,
  ])
    for (const value of [null, [], {}, { id: 123 }, { kode_produk: {} }])
      assert.equal(schema.safeParse(value).success, false);
});
test("permission map fails closed for unknown actions and viewer writes", () => {
  assert.equal(canAction("admin qc", "typo"), false);
  assert.equal(canAction("viewer", "create_produk"), false);
  assert.equal(canAction("qc supervisor", "issue_coa"), true);
  assert.equal(canAction("qc supervisor", "delete_coa"), false);
});
test("gateway refuses sensitive tables, RPC names, traversal, and unbounded limits", () => {
  for (const t of [
    "users",
    "sessions",
    "audit_log",
    "../users",
    "rpc/qc_mutate",
  ])
    assert.equal(dataUrl("https://example.com", t, ""), null);
  assert.equal(
    dataUrl("https://example.com", "master_produk", "?limit=1001"),
    null,
  );
  const url = dataUrl(
    "https://example.com",
    "hasil_uji",
    "?or=(product_name.ilike.*QC*)&limit=50",
  );
  assert.equal(url?.pathname, "/rest/v1/hasil_uji");
  assert.equal(url?.searchParams.get("limit"), "50");
});

test("password verification handles scrypt, malformed hashes and legacy migration without accepting public default", async () => {
  const hash = await hashPassword("a secure test password");
  assert.equal(await verifyPassword("a secure test password", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  for (const malformed of [
    "scrypt$not-hex$00",
    "scrypt$" + "00".repeat(16) + "$ff",
    "invalid",
  ])
    assert.equal(await verifyPassword("anything", malformed), false);
  const legacy = (p: string) =>
    createHash("sha256")
      .update("INBIO::" + p)
      .digest("hex");
  assert.equal(
    await verifyPassword("Legacy password", legacy("Legacy password")),
    true,
  );
  assert.equal(await verifyPassword("INBIONUSA", legacy("INBIONUSA")), false);
  assert.equal(
    await verifyPassword("INBIONUSA", await hashPassword("INBIONUSA")),
    false,
  );
});

test("pass-rate display reserves 100 percent for complete compliance", async () => {
  const { formatPassRate } = await import("../src/lib/format");
  assert.equal(formatPassRate(0, 0), "—");
  assert.equal(formatPassRate(0, 10), "0");
  assert.equal(formatPassRate(10, 10), "100");
  assert.equal(formatPassRate(12, 13), "92.31");
  assert.equal(formatPassRate(2020, 2021), "99.95");
  assert.equal(formatPassRate(99999, 100000), "<100");
});

test("COA expiry uses a calendar year, clamps leap days and ignores supplied expiry", async () => {
  const { coaExpiryDate } = await import("../src/lib/domain/coa-dates");
  assert.equal(coaExpiryDate("2026-10-17"), "2027-10-17");
  assert.equal(coaExpiryDate("2024-02-29"), "2025-02-28");
  assert.equal(coaExpiryDate("2023-02-28"), "2024-02-28");
  assert.equal(coaExpiryDate("2026-02-30"), "");
  const payload = {
    id_hasil: "11111111-1111-4111-8111-111111111111",
    no_coa: "",
    tanda_tangan: "QC",
    tanggal_rilis: "2026-10-17",
    mfg_date: "2026-10-01",
    tanggal_expired: "2030-01-01",
  };
  assert.equal(issueSchema.parse(payload).tanggal_expired, "2027-10-01");
  assert.equal(
    issueSchema.parse({ ...payload, tanggal_expired: undefined })
      .tanggal_expired,
    "2027-10-01",
  );
  assert.equal(
    issueSchema.safeParse({ ...payload, mfg_date: "" }).success,
    false,
  );
  assert.equal(
    issueSchema.safeParse({ ...payload, tanggal_rilis: "2027-10-02" }).success,
    false,
  );
  assert.equal(
    issueSchema.safeParse({ ...payload, tanggal_rilis: "2026-09-30" }).success,
    false,
  );
});

test("analytics intervals cover exactly the selected days without gaps or overlap", async () => {
  const { analyticsBuckets, shiftDate } =
    await import("../src/lib/dashboard-analytics");
  for (const period of [30, 90] as const) {
    const buckets = analyticsBuckets("2026-01-10", period);
    assert.equal(buckets.length, 6);
    assert.equal(buckets[0].from, shiftDate("2026-01-10", 1 - period));
    assert.equal(buckets.at(-1)!.to, "2026-01-10");
    for (let i = 1; i < buckets.length; i++)
      assert.equal(buckets[i].from, shiftDate(buckets[i - 1].to, 1));
  }
});
