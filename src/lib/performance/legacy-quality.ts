import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsBuckets } from "@/lib/dashboard-analytics";
import { businessDate } from "@/lib/domain/validation";

/** Deployment compatibility until 008 is present. Never a fallback for authorization failures. */
export async function legacySummary() {
  const sb = createAdminClient();
  const results = await Promise.all([
    sb.from("master_produk").select("id", { head: true, count: "exact" }),
    sb.from("hasil_uji").select("id", { head: true, count: "exact" }),
    sb
      .from("hasil_uji")
      .select("id", { head: true, count: "exact" })
      .eq("status", "PASS"),
    sb
      .from("hasil_uji")
      .select("id", { head: true, count: "exact" })
      .eq("status", "FAIL"),
    sb.from("coa").select("id", { head: true, count: "exact" }),
    sb
      .from("hasil_uji")
      .select(
        "id,no_lot,tgl_uji,status,created_at,master_produk!inner(kode_produk,nama_produk)",
      )
      .order("created_at", { ascending: false })
      .order("id")
      .limit(8),
  ]);
  if (results.some((r) => r.error)) throw Error("Summary unavailable.");
  return {
    total_produk: results[0].count,
    total_lot: results[1].count,
    lot_pass: results[2].count,
    lot_fail: results[3].count,
    total_coa: results[4].count,
    recent_inspeksi: results[5].data,
  };
}
export async function legacyAnalytics(period: 30 | 90) {
  const sb = createAdminClient(),
    today = businessDate(),
    buckets = analyticsBuckets(today, period);
  const jobs: (() => Promise<void>)[] = [];
  for (const bucket of buckets) {
    for (const status of ["PASS", "FAIL"] as const)
      jobs.push(async () => {
        const { count, error } = await sb
          .from("hasil_uji")
          .select("id", { head: true, count: "exact" })
          .gte("tgl_uji", bucket.from)
          .lte("tgl_uji", bucket.to)
          .eq("status", status);
        if (error || count === null) throw Error("Analytics unavailable.");
        bucket[status === "PASS" ? "passed" : "failed"] = count;
      });
    jobs.push(async () => {
      const { count, error } = await sb
        .from("coa")
        .select("id", { head: true, count: "exact" })
        .gte("tanggal_rilis", bucket.from)
        .lte("tanggal_rilis", bucket.to);
      if (error || count === null) throw Error("Analytics unavailable.");
      bucket.issued = count;
    });
  }
  let index = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (index < jobs.length) await jobs[index++]();
    }),
  );
  if (results.some((r) => r.status === "rejected"))
    throw Error("Analytics unavailable.");
  return { period, from: buckets[0].from, to: today, buckets };
}
export const missingPerformanceRPC = (error: { code?: string } | null) =>
  error?.code === "PGRST202" || error?.code === "42883";
