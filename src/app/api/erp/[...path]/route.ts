import { linkedQuoteOrder } from "@/lib/erp/quote-order";
import { sameOrigin } from "@/lib/erp/origin";
import { toCsv } from "@/lib/export-data";
import { requireUser, logAudit } from "@/lib/auth";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpError } from "@/lib/erp/server";
import { actionSchemas, type ERPAction } from "@/lib/erp/schema";
import type { CoaDocument } from "@/lib/pdf/coa-document";
export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  const { path } = await context.params,
    p = new URL(request.url).searchParams;
  if (path[0] === "export" && path.length === 2) {
    const q = p.get("q") || "",
      state = p.get("state") || "",
      id = p.get("id");
    if (q.length > 100 || state.length > 30 || (id && id.length > 100))
      return privateJson({ message: "Invalid filters." }, 400);
    if (
      ![
        "stock",
        "lots",
        "movements",
        "production",
        "counts",
        "ledger",
        "quotes",
        "orders",
        "customers",
        "catalog",
        "units",
        "locations",
        "access",
        "fulfillment",
        "series",
        "returns",
        "suppliers",
        "materials",
        "purchases",
        "material_stock",
        "material_ledger",
        "opportunities",
        "crm_activities",
        "product_documents",
      ].includes(path[1])
    )
      return privateJson({ message: "Collection not found." }, 404);
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 201; page++) {
      const { data, error } = await erpRpc("erp_read", {
        p_entity: path[1],
        p_id: id,
        p_search: q,
        p_state: state,
        p_page: page,
      });
      if (error) return erpError(error);
      if (data.total > 10000)
        return privateJson(
          {
            message:
              "Narrow the filters to 10,000 records or fewer before exporting.",
          },
          422,
        );
      rows.push(...data.rows);
      if (rows.length >= data.total) break;
    }
    const columns = [
      "number",
      "title",
      "supplier",
      "company",
      "owner",
      "expected_value",
      "expected_close",
      "due_date",
      "assignee",
      "kind",
      "language",
      "revision",
      "display_state",
      "effective_date",
      "expiry_date",
      "quantity",
      "unit",
      "name",
      "code",
      "product",
      "lot_number",
      "location",
      "on_hand",
      "reserved",
      "available",
      "delta",
      "state",
      "date",
      "customer",
      "currency",
      "total",
    ];
    await logAudit(
      session.user.nama_lengkap,
      "EXPORT_ERP_" + path[1],
      JSON.stringify({ q, state, count: rows.length }),
    );
    const csv = toCsv(
      columns,
      rows.map((r) =>
        columns.map((c) =>
          c === "total"
            ? ((r.totals as Record<string, string> | undefined)?.total ??
              r.total)
            : r[c],
        ),
      ),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${path[1]}.csv"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }
  if (path.length === 1) {
    const page = Number(p.get("page") || 1),
      search = p.get("q") || "",
      state = p.get("state") || "",
      id = p.get("id");
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      search.length > 100 ||
      state.length > 30 ||
      (id && id.length > 100)
    )
      return privateJson({ message: "Invalid filters." }, 400);
    const { data, error } = await erpRpc("erp_read", {
      p_entity: path[0],
      p_page: page,
      p_search: search,
      p_state: state,
      p_id: id,
    });
    if (error) return erpError(error);
    if (path[0] === "quotes" && id && data?.rows?.[0]?.state === "accepted") {
      const linked = await linkedQuoteOrder(data.rows[0]);
      if (linked.error) return erpError(linked.error);
      data.rows[0].sales_order = linked.data;
    }
    return privateJson(data);
  }
  if (
    path[0] === "documents" &&
    path.length >= 3 &&
    ["quotes", "movements", "production", "purchases"].includes(path[1])
  ) {
    const { data, error } = await erpRpc("erp_read", {
      p_entity: path[1],
      p_id: path[2],
    });
    if (error) return erpError(error);
    const row = data?.rows?.[0];
    if (!row) return privateJson({ message: "Document not found." }, 404);
    if (p.has("download"))
      await logAudit(session.user.nama_lengkap, "DOWNLOAD_ERP", row.number);
    if (path[1] === "purchases" && path.length === 3) {
      const supplier = row.supplier_data || {};
      const bytes = await (
        await import("@/lib/erp/pdf")
      ).renderERPDocument(
        {
          ...row,
          snapshot: undefined,
          customer: supplier.name,
          customer_data: { ...supplier, billing_address: supplier.address },
          valid_until: row.expected_date,
          lines: (row.lines || []).map((line: Record<string, string>) => ({
            ...line,
            product: line.name,
            discount: "0",
          })),
          totals: { subtotal: row.total, total: row.total },
        },
        "purchase",
      );
      return pdf(bytes, row.number, p.has("download"));
    }
    if (path[3] === "coa") {
      const index = Number(path[4]);
      if (
        row.kind !== "delivery" ||
        !["posted", "reversed"].includes(row.state) ||
        !Number.isInteger(index) ||
        index < 0
      )
        return privateJson({ message: "COA unavailable." }, 404);
      const coa = row.snapshot?.lines?.[index]?.coa;
      if (!coa)
        return privateJson({ message: "No COA attached to this line." }, 404);
      const bytes = await (
        await import("@/lib/pdf/coa-document")
      ).renderCoaPdf(coa as CoaDocument);
      return pdf(bytes, "COA-" + row.number, p.has("download"));
    }
    if (path.length !== 3)
      return privateJson({ message: "Document not found." }, 404);
    try {
      const bytes = await (
        await import("@/lib/erp/pdf")
      ).renderERPDocument(row, path[1] === "quotes" ? "quotation" : "movement");
      return pdf(bytes, row.number, p.has("download"));
    } catch {
      return privateJson({ message: "Could not render this document." }, 422);
    }
  }
  return privateJson({ message: "Not found." }, 404);
}
function pdf(bytes: Uint8Array, name: string, download: boolean) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function POST(request: Request, context: Context) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const { path } = await context.params;
  if (path.length !== 1 || !Object.hasOwn(actionSchemas, path[0]))
    return privateJson({ message: "Unknown operation." }, 404);
  // Same-origin session writes; no cross-site form mutations.
  const origin = request.headers.get("origin");
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(":", "");
  if (!sameOrigin(origin, request.headers.get("host"), protocol))
    return privateJson({ message: "Invalid origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return privateJson({ message: "Use JSON." }, 415);
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 262144)
      return privateJson({ message: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return privateJson({ message: "Invalid JSON." }, 400);
  }
  const parsed = actionSchemas[path[0] as ERPAction].safeParse(body);
  if (!parsed.success)
    return privateJson(
      {
        message: parsed.error.issues[0].message,
        fields: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      422,
    );
  const { data, error } = await erpRpc("erp_mutate", {
    p_action: path[0],
    p_payload: parsed.data,
  });
  return error ? erpError(error) : privateJson(data);
}
