import { missingPerformanceRPC } from "@/lib/performance/legacy-quality";
import { moduleGate } from "@/lib/erp/server";
import { requireUser } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpError } from "@/lib/erp/server";

export async function GET(request: Request) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const period = new URL(request.url).searchParams.get("period") ?? "30";
  if (period !== "30" && period !== "90")
    return privateJson({ message: "Choose a 30 or 90 day period." }, 400);
  const { data, error } = await erpRpc("qc_quality_analytics", {
    p_period: Number(period),
  });
  if (missingPerformanceRPC(error)) {
    const denied = await moduleGate("quality");
    if (denied) return denied;
    try {
      return privateJson(
        await (
          await import("@/lib/performance/legacy-quality")
        ).legacyAnalytics(Number(period) as 30 | 90),
      );
    } catch {
      return privateJson({ message: "Could not load analytics. Retry." }, 503);
    }
  }
  return error ? erpError(error) : privateJson(data);
}
