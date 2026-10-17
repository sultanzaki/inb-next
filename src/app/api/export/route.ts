import { requireUser, logAudit } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  modules,
  exportQuerySchema,
  searchOr,
  orderField,
} from "@/lib/query-filters";
import { businessDate } from "@/lib/domain/validation";
import { toCsv } from "@/lib/export-data";
import { canAction } from "@/lib/types";
import { privateJson } from "@/lib/api-response";
import writeXlsxFile from "write-excel-file/node";
export const maxDuration = 60;
export async function GET(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  const parsed = exportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return privateJson({ message: "Invalid export filters." }, 400);
  const v = parsed.data;
  if (v.module === "audit" && !canAction(session.user.role, "read_audit"))
    return privateJson({ message: "Access denied." }, 403);
  const cfg = modules[v.module],
    today = businessDate(),
    sb = createAdminClient();
  const allowed: Record<string, string[]> = {
    audit: ["all"],
    produk: ["all", "Halal", "Non-Halal"],
    inspeksi: ["all", "PASS", "FAIL"],
    coa: ["all", "active", "expired"],
    arsip: ["all", "active", "expired"],
  };
  if (!allowed[v.module].includes(v.filter))
    return privateJson({ message: "Invalid filter." }, 400);
  const all: Record<string, unknown>[] = [];
  try {
    for (let offset = 0; offset <= 10000; offset += 500) {
      let q = sb
        .from(cfg.table)
        .select(cfg.select)
        .order(orderField(v.module, v.order), {
          ascending:
            v.module === "produk" ? v.order !== "newest" : v.order === "oldest",
        })
        .order("id")
        .range(offset, offset + 499);
      if (v.search) q = q.or(searchOr(cfg.search, v.search));
      if (v.from)
        q = q.gte(
          cfg.date,
          v.from +
            (["created_at", "waktu"].includes(cfg.date)
              ? "T00:00:00+07:00"
              : ""),
        );
      if (v.to)
        q = q.lte(
          cfg.date,
          v.to +
            (["created_at", "waktu"].includes(cfg.date)
              ? "T23:59:59.999999+07:00"
              : ""),
        );
      if (v.product && ["inspeksi", "coa"].includes(v.module))
        q = q.eq("id_produk", v.product);
      if (v.person && ["inspeksi", "audit"].includes(v.module))
        q = q.ilike(
          v.module === "audit" ? "user_name" : "inspector",
          "%" + v.person.replace(/[\\%_]/g, "\\$&") + "%",
        );
      if (v.category && ["produk", "arsip", "audit"].includes(v.module))
        q = q.eq(v.module === "audit" ? "aksi" : "kategori", v.category);
      if (v.filter !== "all") {
        if (v.module === "produk") q = q.eq("status_halal", v.filter);
        if (v.module === "inspeksi") q = q.eq("status", v.filter);
        if (["coa", "arsip"].includes(v.module)) {
          const field =
            v.module === "coa" ? "tanggal_expired" : "masa_kadaluarsa";
          q = v.filter === "expired" ? q.lt(field, today) : q.gte(field, today);
        }
      }
      const { data, error } = await q;
      if (error) throw Error("query");
      all.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (all.length > 10000)
        return privateJson(
          {
            message: "Over 10,000 rows. Narrow the filters to export.",
          },
          422,
        );
      if (!data || data.length < 500) break;
    }
    const headers: Record<string, string[]> = {
      audit: ["Time", "Users", "Actions", "Reference"],
      produk: [
        "Product code",
        "Product name",
        "INCI",
        "Category",
        "Unit",
        "Halal",
        "Packaging",
        "Specification version",
      ],
      inspeksi: [
        "Lot number",
        "Product code",
        "Product name",
        "Sampling",
        "Test date",
        "Inspector",
        "Status",
        "Failure reason",
        "Notes",
        "Specification version",
      ],
      coa: [
        "COA number",
        "Products",
        "Lot number",
        "Release date",
        "Expired",
        "Manufacturing date",
        "Language",
        "Issuer",
      ],
      arsip: [
        "Document title",
        "Category",
        "Effective date",
        "Expired",
        "Link",
      ],
    };
    const rows = all.map((r) => {
      const product = r.master_produk as Record<string, unknown> | undefined,
        snapshot = r.hasil_uji_snapshot as Record<string, unknown> | undefined;
      switch (v.module) {
        case "audit":
          return [r.waktu, r.user_name, r.aksi, r.referensi];
        case "produk":
          return [
            r.kode_produk,
            r.nama_produk,
            r.inci_name,
            r.kategori,
            r.satuan,
            r.status_halal,
            r.tipe_kemasan,
            r.spec_version,
          ];
        case "inspeksi":
          return [
            r.no_lot,
            product?.kode_produk,
            product?.nama_produk,
            r.tgl_sampling,
            r.tgl_uji,
            r.inspector,
            r.status,
            r.failure_reason,
            r.catatan,
            r.spec_version,
          ];
        case "coa":
          return [
            r.no_coa,
            snapshot?.produk,
            r.no_lot,
            r.tanggal_rilis,
            r.tanggal_expired,
            r.mfg_date,
            r.language,
            r.tanda_tangan_digital,
          ];
        default:
          return [
            r.judul_dokumen,
            r.kategori,
            r.tanggal_berlaku,
            r.masa_kadaluarsa,
            r.link_drive,
          ];
      }
    });
    let bytes: Buffer | string;
    if (v.format === "csv") bytes = toCsv(headers[v.module], rows);
    else {
      const data = [
        headers[v.module].map((value) => ({
          value,
          fontWeight: "bold" as const,
        })),
        ...rows.map((row) =>
          row.map((x) =>
            typeof x === "number"
              ? { value: x, type: Number }
              : { value: x == null ? "" : String(x), type: String },
          ),
        ),
      ];
      bytes = await writeXlsxFile(data, {
        sheet: v.module,
        stickyRowsCount: 1,
        columns: headers[v.module].map(() => ({ width: 25 })),
      }).toBuffer();
    }
    await logAudit(
      session.user.nama_lengkap,
      "EXPORT_" + v.format.toUpperCase(),
      JSON.stringify({ module: v.module, count: rows.length, filters: v }),
    );
    return new Response(
      typeof bytes === "string" ? bytes : new Uint8Array(bytes),
      {
        headers: {
          "Content-Type":
            v.format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${v.module}-${today}.${v.format}"`,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return privateJson(
      { message: "Export failed. No partial file was created." },
      503,
    );
  }
}
