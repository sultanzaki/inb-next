"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, logAudit } from "@/lib/auth";
import { canAction } from "@/lib/types";
import { assertUuid } from "@/lib/actions/shared";

/**
 * Server actions untuk semua mutasi Arsip Dokumen.
 * Enforcement peran dilakukan DI SINI (server) — client admin service-role
 * melewati RLS, sehingga pengecekan sesi + peran wajib sebelum tulisan apa pun.
 */

/** Payload serializable yang mencerminkan state form di halaman arsip. */
export interface UploadDokumenPayload {
  judul_dokumen: string;
  kategori: string;
  tanggal_berlaku: string;
  masa_kadaluarsa: string;
  link_drive: string;
}

export type ActionResult = { ok: boolean; error?: string };

const SESSION_EXPIRED = "Sesi berakhir. Muat ulang halaman.";
const FORBIDDEN = "Anda tidak punya izin untuk aksi ini.";

async function auditFailed(userName: string, aksi: string, referensi: string): Promise<void> {
  await logAudit(userName, aksi, referensi.slice(0, 200));
}

export async function uploadDokumenAction(payload: UploadDokumenPayload): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "create_doc")) return { ok: false, error: FORBIDDEN };

  if (!payload.judul_dokumen?.trim() || !payload.kategori?.trim()) {
    return { ok: false, error: "Judul dan kategori wajib diisi." };
  }

  // Allowlist link_drive: hanya tautan http(s) yang boleh disimpan/dirender —
  // blokir skema berbahaya (javascript:, data:, dsb.). Kosong diperbolehkan.
  const link = payload.link_drive?.trim() ?? "";
  if (link) {
    let allowed = false;
    try {
      const u = new URL(link);
      allowed = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return { ok: false, error: "Link Drive harus berupa tautan http/https yang valid." };
    }
  }

  const admin = createAdminClient();

  // Kolom eksplisit — payload client tidak pernah di-spread mentah, dan
  // file_url di-force kosong dari server (belum ada unggah berkas).
  const fields = {
    judul_dokumen: payload.judul_dokumen,
    kategori: payload.kategori,
    tanggal_berlaku: payload.tanggal_berlaku,
    masa_kadaluarsa: payload.masa_kadaluarsa,
    link_drive: payload.link_drive,
    file_url: "",
  };

  const { error } = await admin.from("dokumen_arsip").insert(fields);
  if (error) {
    console.error("[uploadDokumenAction] gagal insert dokumen:", error);
    await auditFailed(
      user.nama_lengkap,
      "create_doc_failed",
      `${payload.judul_dokumen} ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: "Gagal menyimpan dokumen. Coba lagi." };
  }

  await logAudit(user.nama_lengkap, `create_doc: ${payload.judul_dokumen}`, payload.kategori);
  return { ok: true };
}

export async function deleteDokumenAction(id: string): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "delete_doc")) return { ok: false, error: FORBIDDEN };

  const idErr = assertUuid(id);
  if (idErr) return { ok: false, error: idErr };

  const admin = createAdminClient();

  // Ambil baris dulu: judul untuk audit + validasi keberadaan.
  const { data: row, error: getErr } = await admin
    .from("dokumen_arsip")
    .select("id, judul_dokumen")
    .eq("id", id)
    .single();
  if (getErr || !row) {
    console.error("[deleteDokumenAction] dokumen tidak ditemukan:", getErr);
    return { ok: false, error: "Dokumen tidak ditemukan." };
  }
  const judul = (row as { judul_dokumen: string }).judul_dokumen;

  const { error } = await admin.from("dokumen_arsip").delete().eq("id", id);
  if (error) {
    console.error("[deleteDokumenAction] gagal hapus dokumen:", error);
    await auditFailed(
      user.nama_lengkap,
      "delete_doc_failed",
      `${judul} (${id}) ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: "Gagal menghapus dokumen. Coba lagi." };
  }

  await logAudit(user.nama_lengkap, `delete_doc: ${judul}`, id);
  return { ok: true };
}
