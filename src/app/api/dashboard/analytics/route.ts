import { requireUser } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/domain/validation";
import {
  analyticsBuckets,
  shiftDate,
  type DashboardAnalytics,
} from "@/lib/dashboard-analytics";

export async function GET(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  const value = new URL(request.url).searchParams.get("period") ?? "30";
  if (value !== "30" && value !== "90")
    return privateJson({ message: "Choose a 30 or 90 day period." }, 400);
  const period = Number(value) as 30 | 90,
    today = businessDate(),
    buckets = analyticsBuckets(today, period),
    sb = createAdminClient();
  try {
    // Exact database counts; no inspection payloads or bulk rows reach the browser.
    // Four workers bound concurrent queries even when the database contains years of data.
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
          if (error || count === null) throw Error("count_failed");
          bucket[status === "PASS" ? "passed" : "failed"] = count;
        });
      jobs.push(async () => {
        const { count, error } = await sb
          .from("coa")
          .select("id", { head: true, count: "exact" })
          .gte("tanggal_rilis", bucket.from)
          .lte("tanggal_rilis", bucket.to);
        if (error || count === null) throw Error("count_failed");
        bucket.issued = count;
      });
    }
    const documents = { valid: 0, expiring: 0, expired: 0 };
    for (const kind of ["valid", "expiring", "expired"] as const)
      jobs.push(async () => {
        let query = sb
          .from("dokumen_arsip")
          .select("id", { head: true, count: "exact" });
        query =
          kind === "expired"
            ? query.lt("masa_kadaluarsa", today)
            : query.gte("masa_kadaluarsa", today);
        if (kind === "expiring")
          query = query.lte("masa_kadaluarsa", shiftDate(today, 30));
        const { count, error } = await query;
        if (error || count === null) throw Error("count_failed");
        documents[kind] = count;
      });
    let index = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (index < jobs.length) await jobs[index++]();
      }),
    );
    if (results.some((r) => r.status === "rejected"))
      throw Error("count_failed");
    const result: DashboardAnalytics = {
      period,
      from: buckets[0].from,
      to: today,
      buckets,
      documents,
    };
    return privateJson(result);
  } catch {
    return privateJson({ message: "Could not load analytics. Retry." }, 503);
  }
}
