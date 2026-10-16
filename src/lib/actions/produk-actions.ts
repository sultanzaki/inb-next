"use server";
import { mutate } from "./mutate";
import { productSchema, uuid } from "@/lib/domain/validation";
export type { ActionResult } from "./mutate";
export interface SpesifikasiPayload {
  parameter_uji: string;
  tipe_batas: "RANGE" | "MIN" | "MAX" | "TEXT";
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
}

/** Payload serializable yang mencerminkan state form di halaman produk. */
export interface SaveProdukPayload {
  /** Ada => edit produk yang sudah ada; null/undefined => produk baru. */
  id?: string | null;
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: string;
  tipe_kemasan: string;
  spesifikasi: SpesifikasiPayload[];
}


export async function saveProdukAction(payload: SaveProdukPayload) {
 return mutate(payload?.id ? "update_produk" : "create_produk", payload, productSchema);
}
export async function deleteProdukAction(id: string) {
 return mutate("delete_produk", id, uuid.transform(id => ({ id })));
}
