"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, logAudit } from "@/lib/auth";
import { canAction } from "@/lib/types";

/**
 * Server actions untuk semua mutasi Master Produk.
 * Enforcement peran dilakukan DI SINI (server) — client admin service-role
 * melewati RLS, sehingga pengecekan sesi + peran wajib sebelum tulisan apa pun.
 */

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

export type ActionResult = { ok: boolean; error?: string };

const SESSION_EXPIRED = "Sesi berakhir. Muat ulang halaman.";
const FORBIDDEN = "Anda tidak punya izin untuk aksi ini.";

// Pesan error spesifik jalur simpan (bukan turunan pesan hapus).
function friendlySaveError(err: { message?: string; code?: string } | null | undefined): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23505" || /duplicate key|unique constraint/i.test(msg))
    return "Kode produk sudah dipakai. Gunakan kode lain.";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menyimpan produk: data referensi tidak valid.";
  return "Gagal menyimpan produk. Coba lagi.";
}

// Pesan error spesifik jalur hapus.
function friendlyDeleteError(err: { message?: string; code?: string } | null | undefined): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menghapus: produk masih dipakai oleh data lain.";
  return "Gagal menghapus produk. Coba lagi.";
}

async function auditFailed(userName: string, aksi: string, referensi: string): Promise<void> {
  await logAudit(userName, aksi, referensi.slice(0, 200));
}

function refProduk(p: { id?: string | null; kode_produk?: string | null }): string {
  return `${p.kode_produk ?? "-"}${p.id ? ` (${p.id})` : ""}`;
}

export async function saveProdukAction(payload: SaveProdukPayload): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  const actionKey = payload.id ? "update_produk" : "create_produk";
  if (!canAction(user.role, actionKey)) return { ok: false, error: FORBIDDEN };

  if (!payload.kode_produk?.trim() || !payload.nama_produk?.trim()) {
    return { ok: false, error: "Kode dan nama produk wajib diisi." };
  }

  const admin = createAdminClient();
  const fields = {
    kode_produk: payload.kode_produk,
    nama_produk: payload.nama_produk,
    kategori: payload.kategori,
    satuan: payload.satuan,
    status_halal: payload.status_halal,
    tipe_kemasan: payload.tipe_kemasan,
  };
  const specs = (payload.spesifikasi ?? []).map((s, i) => ({ ...s, urutan: i }));

  // Produk baru: insert, lalu spesifikasi bila ada.
  if (!payload.id) {
    const { data: inserted, error: e1 } = await admin
      .from("master_produk")
      .insert(fields)
      .select()
      .single();
    if (e1 || !inserted) {
      console.error("[saveProdukAction] gagal insert produk:", e1);
      await auditFailed(user.nama_lengkap, "create_produk_failed", `${e1?.code ?? ""} ${e1?.message ?? ""}`);
      return { ok: false, error: friendlySaveError(e1) };
    }

    if (specs.length > 0) {
      const { error: e2 } = await admin
        .from("spesifikasi")
        .insert(specs.map((s) => ({ ...s, id_produk: inserted.id })));
      if (e2) {
        // Produk tetap tersimpan (perilaku lama); spesifikasi gagal masuk.
        console.error("[saveProdukAction] gagal insert spesifikasi:", e2);
        await auditFailed(
          user.nama_lengkap,
          "create_produk_failed",
          `spec_insert ${refProduk(inserted)} ${e2.code ?? ""} ${e2.message ?? ""}`
        );
        return {
          ok: false,
          error:
            "Gagal menyimpan spesifikasi. Produk sudah dibuat — buka Edit produk untuk menambahkan spesifikasi.",
        };
      }
    }

    await logAudit(user.nama_lengkap, `create_produk: ${payload.kode_produk}`, inserted.id);
    return { ok: true };
  }

  // Produk lama: update baris produk, lalu simpan ulang spesifikasi secara
  // reversibel — snapshot sebelum hapus, rollback bila insert baru gagal.
  const { error: e1 } = await admin
    .from("master_produk")
    .update(fields)
    .eq("id", payload.id);
  if (e1) {
    console.error("[saveProdukAction] gagal update produk:", e1);
    await auditFailed(user.nama_lengkap, "update_produk_failed", `${refProduk(payload)} ${e1.code ?? ""} ${e1.message ?? ""}`);
    return { ok: false, error: friendlySaveError(e1) };
  }

  const { data: oldSpecs, error: snapErr } = await admin
    .from("spesifikasi")
    .select("*")
    .eq("id_produk", payload.id);
  if (snapErr) {
    console.error("[saveProdukAction] gagal snapshot spesifikasi:", snapErr);
    await auditFailed(user.nama_lengkap, "update_produk_failed", `snapshot ${refProduk(payload)} ${snapErr.message ?? ""}`);
    return { ok: false, error: "Gagal menyimpan spesifikasi. Coba lagi." };
  }

  const { error: delErr } = await admin
    .from("spesifikasi")
    .delete()
    .eq("id_produk", payload.id);
  if (delErr) {
    console.error("[saveProdukAction] gagal hapus spesifikasi lama:", delErr);
    await auditFailed(user.nama_lengkap, "update_produk_failed", `spec_delete ${refProduk(payload)} ${delErr.message ?? ""}`);
    return { ok: false, error: "Gagal menyimpan spesifikasi. Spesifikasi lama tetap utuh. Coba lagi." };
  }

  if (specs.length > 0) {
    const { error: e2 } = await admin
      .from("spesifikasi")
      .insert(specs.map((s) => ({ ...s, id_produk: payload.id! })));
    if (e2) {
      console.error("[saveProdukAction] gagal insert spesifikasi baru:", e2);
      // Rollback: pulihkan snapshot baris lama (best effort).
      const snap = oldSpecs ?? [];
      if (snap.length > 0) {
        const { error: rbErr } = await admin.from("spesifikasi").insert(snap);
        if (rbErr) {
          console.error("[saveProdukAction] gagal memulihkan spesifikasi lama:", rbErr);
          await auditFailed(
            user.nama_lengkap,
            "update_produk_failed",
            `spec_restore_gagal ${refProduk(payload)} ${rbErr.message ?? ""}`
          );
          return {
            ok: false,
            error:
              "Gagal menyimpan spesifikasi, dan pemulihan data lama GAGAL. Jangan tutup dialog; coba simpan lagi atau hubungi admin.",
          };
        }
      }
      await auditFailed(user.nama_lengkap, "update_produk_failed", `spec_insert_rollback_ok ${refProduk(payload)} ${e2.message ?? ""}`);
      return {
        ok: false,
        error: "Gagal menyimpan spesifikasi. Spesifikasi lama telah dipulihkan.",
      };
    }
  }

  await logAudit(user.nama_lengkap, `update_produk: ${payload.kode_produk}`, payload.id);
  return { ok: true };
}

export async function deleteProdukAction(id: string): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "delete_produk")) return { ok: false, error: FORBIDDEN };

  const admin = createAdminClient();

  // Ambil baris produk dulu: kode untuk audit + validasi keberadaan.
  const { data: produk, error: getErr } = await admin
    .from("master_produk")
    .select("id, kode_produk")
    .eq("id", id)
    .single();
  if (getErr || !produk) {
    console.error("[deleteProdukAction] produk tidak ditemukan:", getErr);
    return { ok: false, error: "Produk tidak ditemukan." };
  }
  const ref = refProduk({ id, kode_produk: (produk as { kode_produk: string }).kode_produk });

  // Pre-check COA: menghapus produk akan menyisakan baris COA yatim yang
  // hilang dari daftar COA sementara dashboard tetap menghitungnya.
  const { count: coaCount, error: coaErr } = await admin
    .from("coa")
    .select("id", { count: "exact", head: true })
    .eq("id_produk", id);
  if (coaErr) {
    console.error("[deleteProdukAction] gagal cek COA:", coaErr);
    await auditFailed(user.nama_lengkap, "delete_produk_failed", `precheck_coa ${ref}`);
    return { ok: false, error: "Gagal memuat data. Coba lagi." };
  }
  if ((coaCount ?? 0) > 0) {
    await auditFailed(user.nama_lengkap, "delete_produk_failed", `coa_exists ${ref}`);
    return { ok: false, error: "Produk masih punya COA. Hapus COA-nya dulu." };
  }

  // Pre-check hasil uji: produk tidak boleh dihapus bila masih dirujuk.
  const { data: existingUji, error: ujiErr } = await admin
    .from("hasil_uji")
    .select("id")
    .eq("id_produk", id)
    .limit(1);
  if (ujiErr) {
    console.error("[deleteProdukAction] gagal cek hasil uji:", ujiErr);
    await auditFailed(user.nama_lengkap, "delete_produk_failed", `precheck_uji ${ref}`);
    return { ok: false, error: "Gagal memuat data. Coba lagi." };
  }
  if (existingUji && existingUji.length > 0) {
    await auditFailed(user.nama_lengkap, "delete_produk_failed", `hasil_uji_exists ${ref}`);
    return { ok: false, error: "Produk tidak dapat dihapus karena masih memiliki hasil uji." };
  }

  const { error } = await admin.from("master_produk").delete().eq("id", id);
  if (error) {
    console.error("[deleteProdukAction] gagal hapus produk:", error);
    await auditFailed(user.nama_lengkap, "delete_produk_failed", `${ref} ${error.code ?? ""} ${error.message ?? ""}`);
    return { ok: false, error: friendlyDeleteError(error) };
  }

  await logAudit(
    user.nama_lengkap,
    `delete_produk: ${(produk as { kode_produk: string }).kode_produk}`,
    id
  );
  return { ok: true };
}
