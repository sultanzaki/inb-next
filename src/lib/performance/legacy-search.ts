import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/api-response";
import { searchOr } from "@/lib/query-filters";
import { erpRpc, erpError } from "@/lib/erp/server";
import type { ERPContext, ERPRow } from "@/lib/erp/schema";
export async function legacyGlobalSearch(q: string) {
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
      href:
        "/dashboard/master-data/products?q=" +
        encodeURIComponent(p.kode_produk),
    })),
    ...(inspections.data || []).map((h) => ({
      id: h.id,
      type: "Lot",
      title: h.no_lot,
      description: h.status,
      href: "/dashboard/quality/inspections?q=" + encodeURIComponent(h.no_lot),
    })),
    ...(coas.data || []).map((c) => ({
      id: c.id,
      type: "COA",
      title: c.no_coa,
      description: c.no_lot,
      href: "/dashboard/quality/certificates?q=" + encodeURIComponent(c.no_coa),
    })),
  ];
  const collections = [
    ...(enabled("purchase")
      ? [
          ["purchases", "purchase", "Purchase order"],
          ["materials", "purchase", "Raw material"],
          ["suppliers", "purchase", "Supplier"],
        ]
      : []),
    ...(enabled("crm") ? [["opportunities", "crm", "Opportunity"]] : []),
    ...(enabled("documents")
      ? [["product_documents", "documents", "Product document"]]
      : []),
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
        return (data.rows as ERPRow[]).slice(0, 5).map((r) => ({
          id: r.id,
          type,
          title: r.number || r.name || r.product || r.id,
          description: r.product || r.customer || r.state || "",
          href: `/dashboard/${area === "documents" ? "product-documents" : area}?view=${entity}&q=${encodeURIComponent(r.number || r.name || r.id)}`,
        }));
      }),
    );
    return privateJson({ results: [...results, ...matches.flat()] });
  } catch {
    return privateJson({ message: "Search failed. Retry." }, 503);
  }
}
