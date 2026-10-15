"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, logAudit } from "@/lib/auth";
import { canAction } from "@/lib/types";
import type { HasilUjiItem } from "@/lib/types";
import { assertUuid } from "@/lib/actions/shared";

/**
 * Server actions untuk semua mutasi Inspeksi / Hasil Uji.
 * Enforcement peran dilakukan DI SINI (server) — client admin service-role
 * melewati RLS, sehingga pengecekan sesi + peran wajib sebelum tulisan apa pun.
 */

/** Payload serializable yang mencerminkan state form di halaman inspeksi. */
export interface SaveInspeksiPayload {
  /** Ada => edit hasil uji yang sudah ada; null/undefined => hasil uji baru. */
  id?: string | null;
  id_produk: string;
  no_lot: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  catatan: string;
  status: "PASS" | "FAIL";
  hasil_detail: HasilUjiItem[];
}

export type ActionResult = { ok: boolean; error?: string };

const SESSION_EXPIRED = "Sesi berakhir. Muat ulang halaman.";
const FORBIDDEN = "Anda tidak punya izin untuk aksi ini.";

// Pesan error spesifik jalur simpan (bukan turunan pesan hapus).
function friendlySaveError(err: { message?: string; code?: string } | null | undefined): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menyimpan hasil uji: produk referensi tidak valid.";
  return "Gagal menyimpan hasil uji. Coba lagi.";
}

// Pesan error spesifik jalur hapus.
function friendlyDeleteError(err: { message?: string; code?: string } | null | undefined): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menghapus: hasil uji masih dipakai oleh data lain.";
  return "Gagal menghapus hasil uji. Coba lagi.";
}

async function auditFailed(userName: string, aksi: string, referensi: string): Promise<void> {
  await logAudit(userName, aksi, referensi.slice(0, 200));
}

function refUji(p: { id?: string | null; no_lot?: string | null }): string {
  return `${p.no_lot ?? "-"}${p.id ? ` (${p.id})` : ""}`;
}

export async function saveInspeksiAction(payload: SaveInspeksiPayload): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  const actionKey = payload.id ? "update_uji" : "create_uji";
  if (!canAction(user.role, actionKey)) return { ok: false, error: FORBIDDEN };

  if (!payload.id_produk?.trim() || !payload.no_lot?.trim()) {
    return { ok: false, error: "Produk dan No Lot wajib diisi." };
  }
  if (payload.status !== "PASS" && payload.status !== "FAIL") {
    return { ok: false, error: "Status hasil uji tidak valid." };
  }
  if (payload.id) {
    const err = assertUuid(payload.id);
    if (err) return { ok: false, error: err };
  }

  const admin = createAdminClient();

  // Kolom eksplisit — payload client tidak pernah di-spread mentah, dan id_produk
  // di-force dari nilai yang divalidasi (bukan field bebas dari client).
  const fields = {
    id_produk: payload.id_produk,
    no_lot: payload.no_lot,
    tgl_sampling: payload.tgl_sampling,
    tgl_uji: payload.tgl_uji,
    inspector: payload.inspector,
    catatan: payload.catatan,
    status: payload.status,
    hasil_detail: payload.hasil_detail,
  };

  if (!payload.id) {
    const { error } = await admin.from("hasil_uji").insert(fields);
    if (error) {
      console.error("[saveInspeksiAction] gagal insert hasil uji:", error);
      await auditFailed(
        user.nama_lengkap,
        "create_uji_failed",
        `${refUji(payload)} ${error.code ?? ""} ${error.message ?? ""}`
      );
      return { ok: false, error: friendlySaveError(error) };
    }

    await logAudit(user.nama_lengkap, `create_uji: ${payload.no_lot}`, payload.id_produk);
    return { ok: true };
  }

  const { error } = await admin.from("hasil_uji").update(fields).eq("id", payload.id);
  if (error) {
    console.error("[saveInspeksiAction] gagal update hasil uji:", error);
    await auditFailed(
      user.nama_lengkap,
      "update_uji_failed",
      `${refUji(payload)} ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: friendlySaveError(error) };
  }

  await logAudit(user.nama_lengkap, `update_uji: ${payload.no_lot}`, payload.id);
  return { ok: true };
}

export async function deleteInspeksiAction(id: string): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "delete_uji")) return { ok: false, error: FORBIDDEN };

  const idErr = assertUuid(id);
  if (idErr) return { ok: false, error: idErr };

  const admin = createAdminClient();

  // Ambil baris dulu: no lot untuk audit + validasi keberadaan.
  const { data: row, error: getErr } = await admin
    .from("hasil_uji")
    .select("id, no_lot")
    .eq("id", id)
    .single();
  if (getErr || !row) {
    console.error("[deleteInspeksiAction] hasil uji tidak ditemukan:", getErr);
    return { ok: false, error: "Hasil uji tidak ditemukan." };
  }
  const ref = refUji({ id, no_lot: (row as { no_lot: string }).no_lot });

  const { error } = await admin.from("hasil_uji").delete().eq("id", id);
  if (error) {
    console.error("[deleteInspeksiAction] gagal hapus hasil uji:", error);
    await auditFailed(user.nama_lengkap, "delete_uji_failed", `${ref} ${error.code ?? ""} ${error.message ?? ""}`);
    return { ok: false, error: friendlyDeleteError(error) };
  }

  await logAudit(
    user.nama_lengkap,
    `delete_uji: ${(row as { no_lot: string }).no_lot}`,
    id
  );
  return { ok: true };
}
