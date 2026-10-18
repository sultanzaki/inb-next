import { missingPerformanceRPC } from "@/lib/performance/legacy-quality";
import { moduleGate } from "@/lib/erp/server";
import { requireUser } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpError } from "@/lib/erp/server";

export async function GET() {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const { data, error } = await erpRpc("qc_quality_summary");
  if (missingPerformanceRPC(error)) {
    const denied = await moduleGate("quality");
    if (denied) return denied;
    try {
      return privateJson(
        await (
          await import("@/lib/performance/legacy-quality")
        ).legacySummary(),
      );
    } catch {
      return privateJson({ message: "Could not load summary. Retry." }, 503);
    }
  }
  return error ? erpError(error) : privateJson(data);
}
