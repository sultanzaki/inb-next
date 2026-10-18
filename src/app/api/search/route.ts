import { missingPerformanceRPC } from "@/lib/performance/legacy-quality";
import { requireUser } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpError } from "@/lib/erp/server";
type Hit = {
  id: string;
  type: string;
  title: string;
  description: string;
  path: string;
  view: string | null;
  query: string;
};
export async function GET(request: Request) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return privateJson({ results: [] });
  if (q.length > 100)
    return privateJson({ message: "Search is too long." }, 400);
  const { data, error } = await erpRpc("qc_global_search", { p_search: q });
  if (missingPerformanceRPC(error))
    return (await import("@/lib/performance/legacy-search")).legacyGlobalSearch(
      q,
    );
  if (error) return erpError(error);
  return privateJson({
    results: (data as Hit[]).map(
      ({ id, type, title, description, path, view, query }) => ({
        id,
        type,
        title,
        description,
        href:
          path +
          "?" +
          new URLSearchParams({ ...(view ? { view } : {}), q: query }),
      }),
    ),
  });
}
