import { createAdminClient } from "@/lib/supabase/admin";
import type { z } from "zod";
import type { issueSchema } from "@/lib/domain/validation";
import type { HasilUjiItem } from "@/lib/types";
import type { CoaDocument } from "./coa-document";
type Form = z.output<typeof issueSchema>;
export async function loadCoaSource(form: Form) {
  const { data, error } = await createAdminClient()
    .from("available_hasil_uji")
    .select(
      "*,master_produk!inner(kode_produk,nama_produk,nama_produk_en,inci_name,spec_version,updated_at)",
    )
    .eq("id", form.id_hasil)
    .single();
  if (error || !data || data.status !== "PASS" || data.qc_version !== 1)
    throw Error(
      "Sumber harus berupa inspeksi PASS tervalidasi yang belum disertifikasi.",
    );
  const product = data.master_produk;
  const document: CoaDocument = {
    ...form,
    no_lot: data.no_lot,
    tanda_tangan_digital: form.tanda_tangan,
    hasil_uji_snapshot: {
      produk: product.nama_produk,
      produk_en: product.nama_produk_en,
      kode_produk: product.kode_produk,
      inci_name: product.inci_name,
      ts: data.tgl_sampling,
      tu: data.tgl_uji,
      items: data.hasil_detail as HasilUjiItem[],
    },
  };
  return {
    document,
    sourceUpdatedAt: String(data.updated_at),
    productUpdatedAt: String(product.updated_at),
  };
}
export { createPreviewProof, verifyPreviewProof } from "./preview-proof";
