export interface User {
  id: string;
  username: string;
  role: UserRole;
  is_active?: boolean;
  must_change_password?: boolean;
  nama_lengkap: string;
  effective_actions?: string[];
}

export type UserRole = (typeof import("./rbac").BUSINESS_ROLES)[number];

export interface MasterProduk {
  spec_version?: number;
  inci_name?: string;
  nama_produk_en?: string;
  id: string;
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: "Halal" | "Non-Halal";
  tipe_kemasan: string;
  created_at: string;
  updated_at: string;
}

export interface SpesifikasiItem {
  parameter_en?: string;
  keterangan_en?: string;
  id: string;
  id_produk: string;
  parameter_uji: string;
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
  tipe_batas: "RANGE" | "MIN" | "MAX" | "TEXT";
  urutan: number;
  created_at: string;
}

export interface HasilUjiItem {
  val_en?: string;
  p_en?: string;
  k_en?: string;
  spec_id?: string;
  p: string;
  t: "RANGE" | "MIN" | "MAX" | "TEXT";
  mn: string;
  mx: string;
  u: string;
  k: string;
  val: string;
  st: "PASS" | "FAIL";
}

/**
 * Kolom master_produk yang disematkan PostgREST pada query
 * `select("*, master_produk!inner(kode_produk, nama_produk)")`.
 */
export interface ProdukJoin {
  kode_produk: string;
  nama_produk: string;
}

/**
 * Baris tabel `hasil_uji` (bentuk flat di Postgres — nama/kode produk TIDAK
 * jadi kolom; ambil dari join master_produk).
 */
export interface HasilUji {
  superseded?: boolean;
  failure_reason?: string;
  spec_version?: number;
  id: string;
  no_lot: string;
  id_produk: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  hasil_detail: HasilUjiItem[];
  status: "PASS" | "FAIL";
  catatan: string | null;
  created_at: string;
  updated_at: string;
}

/** hasil_uji + join master_produk (bentuk baris list dashboard/inspeksi). */
export type HasilUjiRow = HasilUji & {
  master_produk: ProdukJoin;
  coa_lot?: import("./domain/coa-production-dates").CoaLotDates | null;
};

/**
 * Baris tabel `coa` (bentuk flat di Postgres). Snapshot hasil uji ditulis
 * server saat penerbitan; bentuknya dikunci oleh coa-actions.ts.
 */
export interface COA {
  withdrawn?: boolean;
  language?: "id" | "en";
  inci_name?: string;
  compliance_statement?: string;
  delivery_date?: string | null;
  template_version?: string;
  id: string;
  no_coa: string;
  id_produk: string;
  no_lot: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  hasil_uji_snapshot: {
    produk: string;
    produk_en?: string;
    inci_name?: string;
    spec_version?: number;
    kode_produk?: string;
    ts: string;
    tu: string;
    items: HasilUjiItem[];
  };
  tanda_tangan_digital: string;
  mfg_date: string | null;
  created_at: string;
  updated_at: string;
}

/** COA + join master_produk (bentuk baris list di halaman COA). */
export type CoaRow = COA & { master_produk: ProdukJoin };

export interface DokumenArsip {
  id: string;
  judul_dokumen: string;
  kategori: string;
  tanggal_berlaku: string;
  masa_kadaluarsa: string;
  link_drive: string;
  file_url: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  waktu: string;
  user_name: string;
  aksi: string;
  referensi: string;
}

export interface DashboardData {
  total_produk: number;
  total_lot: number;
  lot_pass: number;
  lot_fail: number;
  total_coa: number;
  recent_inspeksi: HasilUjiRow[];
}

export const ROLE_ALLOW: Record<string, UserRole[]> = {
  save_draft: ["admin qc", "administrator inbionusa", "qc supervisor"],
  delete_draft: ["admin qc", "administrator inbionusa", "qc supervisor"],
  manage_users: ["admin qc", "administrator inbionusa"],
  read_audit: ["admin qc", "administrator inbionusa"],
  delete_produk: ["admin qc", "administrator inbionusa"],
  delete_uji: ["admin qc", "administrator inbionusa"],
  delete_coa: ["admin qc", "administrator inbionusa"],
  delete_doc: ["admin qc", "administrator inbionusa"],
  create_doc: ["admin qc", "administrator inbionusa"],
  update_coa: ["admin qc", "administrator inbionusa", "qc supervisor"],
  issue_coa: ["admin qc", "administrator inbionusa", "qc supervisor"],
  create_produk: ["admin qc", "administrator inbionusa", "qc supervisor"],
  update_produk: ["admin qc", "administrator inbionusa", "qc supervisor"],
  create_uji: ["admin qc", "administrator inbionusa", "qc supervisor"],
  update_uji: ["admin qc", "administrator inbionusa", "qc supervisor"],
};

export function canAction(subject: UserRole | User, action: string): boolean {
  if (typeof subject !== "string") {
    if (subject.effective_actions)
      return subject.effective_actions.includes(action);
    // Safe compatibility with accounts predating the RBAC migration.
    return (
      [
        "admin qc",
        "administrator inbionusa",
        "qc supervisor",
        "viewer",
      ].includes(subject.role) && canAction(subject.role, action)
    );
  }
  const role = subject;
  const allowed = ROLE_ALLOW[action];
  if (!allowed) return false; // Unknown actions fail closed.
  return allowed.includes(role);
}

export function isWriteRole(role: UserRole): boolean {
  return Object.values(ROLE_ALLOW).some((roles) => roles.includes(role));
}

export interface InspectionDraft {
  id: string;
  owner_id: string;
  product_id: string | null;
  no_lot: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface SpecVersion {
  id: string;
  id_produk: string;
  version: number;
  product_snapshot: MasterProduk;
  specifications: SpesifikasiItem[];
  actor: string;
  revision_note: string;
  created_at: string;
}
