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
}

export interface HasilUjiItem {
  p: string;
  t: 'RANGE' | 'MIN' | 'MAX' | 'TEXT';
  mn: string;
  mx: string;
  u: string;
  k: string;
  val: string;
  st: 'PASS' | 'FAIL';
}

export interface HasilUji {
  id: string;
  no_lot: string;
  id_produk: string;
  kode_produk: string;
  nama_produk: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  hasil_detail: HasilUjiItem[];
  status: 'PASS' | 'FAIL';
  catatan: string;
  created_at: string;
}

export interface COA {
  id: string;
  no_coa: string;
  id_produk: string;
  kode_produk: string;
  nama_produk: string;
  no_lot: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  hasil_uji_snapshot: {
    produk: string;
    ts: string;
    tu: string;
    items: HasilUjiItem[];
  };
  tanda_tangan_digital: string;
  mfg_date: string;
  created_at: string;
}

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
  recent_inspeksi: HasilUji[];
}

export const ROLE_ALLOW: Record<string, UserRole[]> = {
  delete_produk: ['admin qc', 'administrator inbionusa'],
  delete_uji: ['admin qc', 'administrator inbionusa'],
  delete_coa: ['admin qc', 'administrator inbionusa'],
  delete_doc: ['admin qc', 'administrator inbionusa'],
  create_doc: ['admin qc', 'administrator inbionusa'],
  update_coa: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
  issue_coa: ['admin qc', 'administrator inbionusa', 'qc supervisor'],
};

export function canAction(role: UserRole, action: string): boolean {
  const allowed = ROLE_ALLOW[action];
  if (!allowed) return true; // not restricted
  return allowed.includes(role);
}

export function isWriteRole(role: UserRole): boolean {
  return role !== 'viewer';
}
