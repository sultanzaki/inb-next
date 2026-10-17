import { z } from "zod";
import { escapeOrTerm } from "./filter-utils";
export const modules = {
  audit: {
    table: "audit_log",
    date: "waktu",
    search: ["user_name", "aksi", "referensi"],
    select: "id,waktu,user_name,aksi,referensi",
  },
  produk: {
    table: "master_produk",
    date: "created_at",
    search: ["nama_produk", "kode_produk"],
    select: "*",
  },
  inspeksi: {
    table: "hasil_uji",
    date: "tgl_uji",
    search: ["no_lot", "product_name"],
    select: "*,master_produk!inner(kode_produk,nama_produk)",
  },
  coa: {
    table: "coa",
    date: "tanggal_rilis",
    search: ["no_coa", "no_lot", "product_name"],
    select: "*,master_produk!inner(kode_produk,nama_produk)",
  },
  arsip: {
    table: "dokumen_arsip",
    date: "tanggal_berlaku",
    search: ["judul_dokumen", "kategori"],
    select: "*",
  },
} as const;
export type ModuleName = keyof typeof modules;
export type AdvancedFilters = {
  from: string;
  to: string;
  product: string;
  person: string;
  category: string;
};
export const emptyFilters: AdvancedFilters = {
  from: "",
  to: "",
  product: "",
  person: "",
  category: "",
};
export const exportQuerySchema = z
  .object({
    module: z.enum(["produk", "inspeksi", "coa", "arsip", "audit"]),
    format: z.enum(["csv", "xlsx"]),
    search: z.string().max(100).default(""),
    filter: z.string().max(30).default("all"),
    order: z.enum(["default", "newest", "oldest"]).default("default"),
    from: z.union([z.iso.date(), z.literal("")]).default(""),
    to: z.union([z.iso.date(), z.literal("")]).default(""),
    product: z.union([z.uuid(), z.literal("")]).default(""),
    person: z.string().max(100).default(""),
    category: z.string().max(100).default(""),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, "Invalid date range.");
export function searchOr(fields: readonly string[], query: string) {
  const term = escapeOrTerm(query);
  return fields.map((field) => `${field}.ilike."%${term}%"`).join(",");
}
export function orderField(module: ModuleName, order: string) {
  return module === "audit"
    ? "waktu"
    : module === "produk" && order === "default"
      ? "nama_produk"
      : "created_at";
}
