import { authorizedRead } from "@/lib/authorized-read";
import { requireUser, logAudit } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpError, erpUxError } from "@/lib/erp/server";
import { sameOrigin } from "@/lib/erp/origin";
import { commandPayload } from "@/lib/operations/validation";
import { workCollections, workCommands } from "@/lib/operations/catalog";
import { parseTableQuery, fieldValue } from "@/lib/tables/schema";
import { queryTypes } from "@/lib/tables/postgrest";
import { validationFields } from "@/lib/erp/ux";
import { toCsv } from "@/lib/export-data";
import { z } from "zod";
export const maxDuration = 60;
type Context = { params: Promise<{ entity: string }> };
const lookups = new Set([
  "suppliers",
  "products",
  "units",
  "staff",
  "customers",
  "opportunities",
  "sales_orders",
  "product_documents",
  "deliveries",
  "material_lots",
  "finished_lots",
  "transfer_destinations",
  "history",
  "genealogy",
  "case_progress",
]);
export async function GET(request: Request, context: Context) {
  if (new URL(request.url).searchParams.has("export")) {
    const actor = await requireUser();
    if (!actor) return privateJson({ message: "Session expired." }, 401);
    return readRequest(request, context, actor.user.nama_lengkap);
  }
  return authorizedRead(requireUser, () => readRequest(request, context));
}
async function readRequest(
  request: Request,
  context: Context,
  actorName?: string,
) {
  const { entity } = await context.params,
    p = new URL(request.url).searchParams;
  if (!Object.hasOwn(workCollections, entity) && !lookups.has(entity))
    return privateJson({ message: "Collection not found." }, 404);
  let scope: unknown, grid;
  try {
    scope = JSON.parse(p.get("scope") || "{}");
    grid = workCollections[entity]
      ? queryTypes(
          "work_" + entity,
          parseTableQuery(p.get("grid"), "work_" + entity),
        )
      : {};
  } catch {
    return privateJson({ message: "Review the selected filters." }, 400);
  }
  const query = {
    search: p.get("q") || "",
    state: p.get("state") || "",
    page: Number(p.get("page") || 1),
    id: p.get("id") || undefined,
    source: p.get("source") || undefined,
    scope,
    grid,
  };
  if (
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    query.search.length > 100 ||
    JSON.stringify(scope).length > 1500
  )
    return privateJson({ message: "Invalid filters." }, 400);
  if (p.has("export")) {
    const definition = workCollections[entity];
    if (!definition)
      return privateJson({ message: "Export unavailable." }, 400);
    const format = p.get("format") || p.get("export");
    if (!["csv", "xlsx"].includes(format || ""))
      return privateJson({ message: "Choose CSV or Excel." }, 400);
    const columns =
      p.get("columns")?.split(",") || definition.columns.map((c) => c.key);
    if (
      !columns.length ||
      columns.some((key) => !definition.columns.some((c) => c.key === key))
    )
      return privateJson({ message: "Invalid export columns." }, 400);
    const records: Record<string, unknown>[] = [];
    for (let page = 1; page <= 201; page++) {
      const { data, error } = await erpRpc("erp_work_read", {
        p_entity: entity,
        p_query: { ...query, page },
      });
      if (error) return erpUxError(error);
      if (data.total > 10000)
        return privateJson(
          { message: "Narrow filters to 10,000 records or fewer." },
          422,
        );
      records.push(...data.rows);
      if (records.length >= data.total) break;
    }
    if (actorName)
      await logAudit(
        actorName,
        "EXPORT_OPERATIONS_" + entity,
        JSON.stringify({
          search: query.search,
          state: query.state,
          count: records.length,
        }),
      );
    const headers = columns.map(
        (key) => definition.columns.find((c) => c.key === key)!.label,
      ),
      values = records.map((row) => columns.map((key) => fieldValue(row, key)));
    if (format === "xlsx") {
      const { default: writeXlsxFile } = await import("write-excel-file/node");
      const bytes = await writeXlsxFile(
        [
          headers.map((value) => ({ value, fontWeight: "bold" as const })),
          ...values.map((row) =>
            row.map((value) => ({ value: value == null ? "" : String(value) })),
          ),
        ],
        { sheet: "Records" },
      ).toBuffer();
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${entity}.xlsx"`,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      });
    }
    return new Response(toCsv(headers, values), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entity}.csv"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }
  const { data, error } = await erpRpc("erp_work_read", {
    p_entity: entity,
    p_query: query,
  });
  return error ? erpUxError(error) : privateJson(data);
}
export async function POST(request: Request, context: Context) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const { entity: action } = await context.params;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(":", "");
  if (
    !sameOrigin(
      request.headers.get("origin"),
      request.headers.get("host"),
      protocol,
    )
  )
    return privateJson({ message: "Invalid origin." }, 403);
  if (!Object.hasOwn(workCommands, action))
    return privateJson({ message: "Unknown operation." }, 404);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return privateJson({ message: "Use JSON." }, 415);
  let raw: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 262144)
      return privateJson({ message: "Form is too large." }, 413);
    raw = JSON.parse(body);
  } catch {
    return privateJson({ message: "Invalid JSON." }, 400);
  }
  let payload;
  try {
    payload = commandPayload(action, raw);
  } catch (error) {
    if (error instanceof z.ZodError)
      return privateJson(
        {
          message: "Review the highlighted fields.",
          fields: validationFields(error.issues),
        },
        422,
      );
    return privateJson({ message: "Invalid operation." }, 400);
  }
  const { data, error } = await erpRpc("erp_work_mutate", {
    p_action: action,
    p_payload: payload,
  });
  return error ? erpError(error) : privateJson(data);
}
