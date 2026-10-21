import { toCsv } from "@/lib/export-data";
import {
  parseTableQuery,
  entityColumns,
  fieldValue,
} from "@/lib/tables/schema";
import { applyTableQuery } from "@/lib/tables/postgrest";
import { requireUser, logAudit } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAction } from "@/lib/types";
import { searchOr } from "@/lib/query-filters";
import { privateJson } from "@/lib/api-response";
export async function GET(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  if (!canAction(session.user, "manage_users"))
    return privateJson({ message: "Access denied." }, 403);
  const params = new URL(request.url).searchParams,
    q = (params.get("q") || "").slice(0, 100),
    offset = Number(params.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    return privateJson({ message: "Invalid page." }, 400);
  let grid;
  try {
    grid = parseTableQuery(params.get("grid"), "users");
  } catch {
    return privateJson({ message: "Invalid table filters." }, 400);
  }
  let query = applyTableQuery(
    createAdminClient()
      .from("users")
      .select(
        "id,username,role,nama_lengkap,is_active,must_change_password,created_at,updated_at",
        { count: "exact" },
      ),
    grid,
  )
    .order("nama_lengkap")
    .order("id")
    .range(offset, offset + 49);
  if (q) query = query.or(searchOr(["username", "nama_lengkap"], q));
  const { data, count, error } = await query;
  if (!error && params.has("format")) {
    const format = params.get("format");
    if (!["csv", "xlsx"].includes(format || ""))
      return privateJson({ message: "Choose CSV or Excel." }, 400);
    if ((count || 0) > 10000)
      return privateJson(
        { message: "Narrow filters to 10,000 users or fewer." },
        422,
      );
    const columns = entityColumns.users,
      selected = params.get("columns")?.split(",") || columns.map((c) => c.key);
    if (
      selected.length > columns.length ||
      selected.some((key) => !columns.some((c) => c.key === key))
    )
      return privateJson({ message: "Invalid export columns." }, 400);
    const all: Record<string, unknown>[] = [];
    for (let start = 0; start < (count || 0); start += 500) {
      const part = await query.range(start, start + 499);
      if (part.error)
        return privateJson({ message: "Export failed. Retry." }, 503);
      all.push(...(part.data || []));
    }
    const headers = selected.map(
        (key) => columns.find((c) => c.key === key)!.label,
      ),
      values = all.map((row) => selected.map((key) => fieldValue(row, key)));
    await logAudit(
      session.user.nama_lengkap,
      "EXPORT_USERS",
      JSON.stringify({ count: all.length }),
    );
    let body: string | Uint8Array<ArrayBuffer> = toCsv(headers, values);
    if (format === "xlsx") {
      const write = (await import("write-excel-file/node")).default;
      const buffer = await write(
        [
          headers.map((value) => ({ value, fontWeight: "bold" as const })),
          ...values.map((row) =>
            row.map((value) => ({ value: value == null ? "" : String(value) })),
          ),
        ],
        { sheet: "Users" },
      ).toBuffer();
      body = new Uint8Array(buffer);
    }
    return new Response(body, {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="users.${format}"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }
  return error
    ? privateJson({ message: "Could not load users." }, 503)
    : privateJson({ data, count });
}
