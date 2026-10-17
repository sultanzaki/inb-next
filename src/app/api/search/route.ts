import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/api-response";
import { searchOr } from "@/lib/query-filters";
export async function GET(request: Request) {
  if (!(await requireUser()))
    return privateJson({ message: "Sesi berakhir." }, 401);
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return privateJson({ results: [] });
  if (q.length > 100)
    return privateJson({ message: "Kata pencarian terlalu panjang." }, 400);
  const sb = createAdminClient();
  const [products, inspections, coas] = await Promise.all([
    sb
      .from("master_produk")
      .select("id,kode_produk,nama_produk")
      .or(searchOr(["kode_produk", "nama_produk", "inci_name"], q))
      .order("nama_produk")
      .limit(8),
    sb
      .from("hasil_uji")
      .select("id,no_lot,status,master_produk!inner(kode_produk,nama_produk)")
      .or(searchOr(["no_lot", "product_name"], q))
      .order("created_at", { ascending: false })
      .order("id")
      .limit(8),
    sb
      .from("coa")
      .select("id,no_coa,no_lot,hasil_uji_snapshot")
      .or(searchOr(["no_coa", "no_lot", "product_name"], q))
      .order("created_at", { ascending: false })
      .order("id")
      .limit(8),
  ]);
  if (products.error || inspections.error || coas.error)
    return privateJson(
      { message: "Pencarian belum berhasil. Coba lagi." },
      503,
    );
  const results = [
    ...(products.data || []).map((p) => ({
      id: p.id,
      type: "Produk",
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
  return privateJson({ results });
}
