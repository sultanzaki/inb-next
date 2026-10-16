export interface User {
  id: string;
  username: string;
  role: UserRole;
  nama_lengkap: string;
}

export type UserRole = 'admin qc' | 'administrator inbionusa' | 'qc supervisor' | 'viewer';

export interface MasterProduk {
  id: string;
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: 'Halal' | 'Non-Halal';
  tipe_kemasan: string;
  created_at: string;
  updated_at: string;
}

export interface SpesifikasiItem {
  id: string;
  id_produk: string;
  parameter_uji: string;
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
  tipe_batas: 'RANGE' | 'MIN' | 'MAX' | 'TEXT';
  urutan: number;
  created_at: string;
}

export interface HasilUjiItem {
  spec_id?: string;
  p: string;
  t: 'RANGE' | 'MIN' | 'MAX' | 'TEXT';
  mn: string;
  mx: string;
  u: string;
  k: string;
  val: string;
  st: 'PASS' | 'FAIL';
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
  id: string;
  no_lot: string;
  id_produk: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  hasil_detail: HasilUjiItem[];
  status: 'PASS' | 'FAIL';
  catatan: string | null;
  created_at: string;
  updated_at: string;
}

/** hasil_uji + join master_produk (bentuk baris list dashboard/inspeksi). */
export type HasilUjiRow = HasilUji & { master_produk: ProdukJoin };

/**
 * Baris tabel `coa` (bentuk flat di Postgres). Snapshot hasil uji ditulis
 * server saat penerbitan; bentuknya dikunci oleh coa-actions.ts.
 */
export interface COA {
  id: string;
  no_coa: string;
  id_produk: string;
  no_lot: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  hasil_uji_snapshot: {
    produk: string;
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
  dok_berlaku: number;
  dok_expired: number;
  recent_inspeksi: HasilUjiRow[];
}

export const ROLE_ALLOW: Record<string, UserRole[]> = {
  delete_produk: ['admin qc', 'administrator inbionusa'],
  delete_uji: ['admin qc', 'administrator inbionusa'],
  delete_coa: ['admin qc', 'administrator inbionusa'],
  delete_doc: ['admin qc', 'administrator inbionusa'],
  create_doc: ['admin qc', 'administrator inbionusa'],
  update_coa: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  issue_coa: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  create_produk: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  update_produk: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  create_uji: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  update_uji: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
};

export function canAction(role: UserRole, action: string): boolean {
  const allowed = ROLE_ALLOW[action];
  if (!allowed) return false; // Unknown actions fail closed.
  return allowed.includes(role);
}

export function isWriteRole(role: UserRole): boolean {
  return role !== 'viewer';
}
