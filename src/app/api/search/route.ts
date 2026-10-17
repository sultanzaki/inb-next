import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/api-response";
import { searchOr } from "@/lib/query-filters";
import { erpRpc, erpError } from "@/lib/erp/server";
import type { ERPContext, ERPRow } from "@/lib/erp/schema";
export async function GET(request: Request) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return privateJson({ results: [] });
  if (q.length > 100)
    return privateJson({ message: "Search is too long." }, 400);
  const { data: context, error } = await erpRpc("erp_read", {
    p_entity: "context",
  });
  if (error) return erpError(error);
  const enabled = (key: string) =>
    (context as ERPContext).modules.some(
      (m) => m.key === key && m.state !== "disabled" && m.read,
    );
  const sb = createAdminClient();
  const [products, inspections, coas] = await Promise.all([
    sb
      .from("master_produk")
      .select("id,kode_produk,nama_produk")
      .or(searchOr(["kode_produk", "nama_produk", "inci_name"], q))
      .order("nama_produk")
      .limit(8),
    enabled("quality")
      ? sb
          .from("hasil_uji")
          .select("id,no_lot,status")
          .or(searchOr(["no_lot", "product_name"], q))
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    enabled("quality")
      ? sb
          .from("coa")
          .select("id,no_coa,no_lot")
          .or(searchOr(["no_coa", "no_lot", "product_name"], q))
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error || inspections.error || coas.error)
    return privateJson({ message: "Search failed. Retry." }, 503);
  const results = [
    ...(products.data || []).map((p) => ({
      id: p.id,
      type: "Products",
      title: p.nama_produk,
      description: p.kode_produk,
      href: "/dashboard/produk?q=" + encodeURIComponent(p.kode_produk),
    })),
    ...(inspections.data || []).map((h) => ({
      id: h.id,
      type: "Lot",
      title: h.no_lot,
      description: h.status,
      href: "/dashboard/inspeksi?q=" + encodeURIComponent(h.no_lot),
    })),
    ...(coas.data || []).map((c) => ({
      id: c.id,
      type: "COA",
      title: c.no_coa,
      description: c.no_lot,
      href: "/dashboard/coa?q=" + encodeURIComponent(c.no_coa),
    })),
  ];
  const collections = [
    ...(enabled("warehouse") ? [["lots", "warehouse", "Lots"]] : []),
    ...(enabled("sales")
      ? [
          ["quotes", "sales", "Quotation"],
          ["orders", "sales", "Order"],
        ]
      : []),
    ...(enabled("production")
      ? [["production", "production", "Production"]]
      : []),
  ];
  try {
    const matches = await Promise.all(
      collections.map(async ([entity, area, type]) => {
        const { data, error } = await erpRpc("erp_read", {
          p_entity: entity,
          p_search: q,
        });
        if (error) throw Error();
        return (data.rows as ERPRow[])
          .slice(0, 5)
          .map((r) => ({
            id: r.id,
            type,
            title: r.number || r.name || r.product || r.id,
            description: r.product || r.customer || r.state || "",
            href: `/dashboard/${area}?view=${entity}&q=${encodeURIComponent(r.number || r.name || r.id)}`,
          }));
      }),
    );
    return privateJson({ results: [...results, ...matches.flat()] });
  } catch {
    return privateJson({ message: "Search failed. Retry." }, 503);
  }
}
