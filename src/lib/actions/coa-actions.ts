"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, logAudit } from "@/lib/auth";
import { canAction } from "@/lib/types";

/**
 * Server actions untuk semua mutasi COA. Enforcement peran dilakukan DI SINI
 * (server) — client admin service-role melewati RLS, sehingga pengecekan
 * sesi + peran wajib sebelum tulisan apa pun.
 *
 * Derivasi nomor COA (max-seq) juga pindah ke server: daftar di client adalah
 * hasil search-filter, dan dua penerbit bersamaan yang menghitung di client
 * bisa memilih nomor sama lalu bertabrakan di unique constraint.
 */

export type ActionResult = { ok: boolean; error?: string };

const SESSION_EXPIRED = "Sesi berakhir. Muat ulang halaman.";
const FORBIDDEN = "Anda tidak punya izin untuk aksi ini.";

/** Payload untuk menerbitkan COA baru dari satu hasil uji PASS. */
export interface IssueCoaPayload {
  id_hasil: string;
  /** Kosong => nomor diturunkan otomatis dari max-seq server. */
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}

/** Payload untuk mengubah COA yang sudah ada. */
export interface UpdateCoaPayload {
  id: string;
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}

async function auditFailed(userName: string, aksi: string, referensi: string): Promise<void> {
  await logAudit(userName, aksi, referensi.slice(0, 200));
}

function friendlyCoaError(err: { message?: string; code?: string } | null | undefined): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23505" || /duplicate key|unique constraint/i.test(msg))
    return "No COA sudah digunakan. Gunakan nomor lain.";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menyimpan COA: data referensi tidak valid.";
  return "Gagal menyimpan COA. Coba lagi.";
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Nomor COA berikutnya diturunkan dari data SERVER (bukan daftar client yang
 * ter-search-filter): ambil no_coa terbesar, naikkan seq terakhirnya.
 * Gagal lookup tidak boleh jatuh ke seq 0001 — lempar error agar pemanggil
 * tidak membakar retry insert melawan max asli.
 */
async function deriveNextNoCOA(admin: AdminClient): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await admin
    .from("coa")
    .select("no_coa")
    .order("no_coa", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = (data as { no_coa: string }[] | null)?.[0]?.no_coa ?? "";
  const m = last.match(/(\d+)$/);
  const seq = (m ? parseInt(m[1], 10) : 0) + 1;
  return `COA/IBN/${year}/${seq.toString().padStart(4, "0")}`;
}

/** Prefill nomor COA di dialog Terbitkan COA (read-only, best-effort). */
export async function getNextNoCOAAction(): Promise<string> {
  const session = await requireUser();
  if (!session?.user) throw new Error(SESSION_EXPIRED);
  const admin = createAdminClient();
  return deriveNextNoCOA(admin);
}

export async function issueCoaAction(payload: IssueCoaPayload): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "issue_coa")) return { ok: false, error: FORBIDDEN };

  if (!payload.id_hasil?.trim()) {
    return { ok: false, error: "Pilih hasil uji." };
  }

  const admin = createAdminClient();

  // Snapshot + foreign key diambil dari baris hasil uji DI SERVER — payload
  // client hanya menyuplai id_hasil, sehingga id_produk/no_lot tidak bisa
  // dipalsukan dari sisi browser.
  const { data: hasil, error: hasilErr } = await admin
    .from("hasil_uji")
    .select("id, id_produk, no_lot, tgl_sampling, tgl_uji, hasil_detail, status, master_produk(nama_produk)")
    .eq("id", payload.id_hasil)
    .single();
  if (hasilErr || !hasil) {
    console.error("[issueCoaAction] hasil uji tidak ditemukan:", hasilErr);
    await auditFailed(user.nama_lengkap, "issue_coa_failed", `hasil_uji:${payload.id_hasil}`);
    return { ok: false, error: "Hasil uji tidak ditemukan." };
  }
  const h = hasil as {
    id: string;
    id_produk: string;
    no_lot: string;
    tgl_sampling: string;
    tgl_uji: string;
    hasil_detail: unknown;
    status: string;
    master_produk: { nama_produk: string } | { nama_produk: string }[] | null;
  };
  if (h.status !== "PASS") {
    await auditFailed(user.nama_lengkap, "issue_coa_failed", `not_pass ${refHasil(h)}`);
    return { ok: false, error: "COA hanya dapat diterbitkan dari hasil uji berstatus PASS." };
  }

  const produkRow = Array.isArray(h.master_produk) ? h.master_produk[0] : h.master_produk;
  const snapshot = {
    produk: produkRow?.nama_produk ?? "",
    ts: h.tgl_sampling,
    tu: h.tgl_uji,
    items: (h.hasil_detail ?? []) as Record<string, unknown>[],
  };

  const userNo = payload.no_coa?.trim() ?? "";
  let no_coa = userNo || (await deriveNextNoCOA(admin));

  // Collision-safe numbering: nomor otomatis yang kalah race (23505) dicoba
  // ulang dengan nomor baru (maks 3 percobaan). Nomor pilihan user tidak
  // pernah diregenerasi — tabrakan miliknya surface sebagai error.
  for (let attempt = 1; ; attempt++) {
    // Kolom eksplisit — payload client tidak pernah di-spread mentah.
    const { error } = await admin.from("coa").insert({
      no_coa,
      id_produk: h.id_produk,
      no_lot: h.no_lot,
      tanggal_rilis: payload.tanggal_rilis,
      tanggal_expired: payload.tanggal_expired,
      hasil_uji_snapshot: snapshot,
      tanda_tangan_digital: payload.tanda_tangan,
      mfg_date: payload.mfg_date,
    });
    if (!error) break;
    if (error.code === "23505" && !userNo && attempt < 3) {
      no_coa = await deriveNextNoCOA(admin);
      continue;
    }
    console.error("[issueCoaAction] gagal insert COA:", error);
    await auditFailed(
      user.nama_lengkap,
      "issue_coa_failed",
      `${refHasil(h)} no=${no_coa} ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: friendlyCoaError(error) };
  }

  await logAudit(user.nama_lengkap, `issue_coa: ${no_coa}`, `hasil_uji:${h.id}`);
  return { ok: true };
}

function refHasil(h: { id: string; no_lot: string }): string {
  return `${h.no_lot} (${h.id})`;
}

export async function updateCoaAction(payload: UpdateCoaPayload): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "update_coa")) return { ok: false, error: FORBIDDEN };

  if (!payload.id?.trim()) {
    return { ok: false, error: "COA tidak ditemukan." };
  }
  if (!payload.no_coa?.trim()) {
    return { ok: false, error: "No COA wajib diisi." };
  }

  const admin = createAdminClient();

  // Kolom eksplisit — payload client tidak pernah di-spread mentah, dan
  // id_produk/no_lot/snapshot tidak tersentuh (bukan field form edit).
  const { error } = await admin
    .from("coa")
    .update({
      no_coa: payload.no_coa,
      tanggal_rilis: payload.tanggal_rilis,
      tanggal_expired: payload.tanggal_expired,
      mfg_date: payload.mfg_date,
      tanda_tangan_digital: payload.tanda_tangan,
    })
    .eq("id", payload.id);
  if (error) {
    console.error("[updateCoaAction] gagal update COA:", error);
    await auditFailed(
      user.nama_lengkap,
      "update_coa_failed",
      `no=${payload.no_coa} (${payload.id}) ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: friendlyCoaError(error) };
  }

  await logAudit(user.nama_lengkap, `update_coa: ${payload.no_coa}`, payload.id);
  return { ok: true };
}

export async function deleteCoaAction(id: string): Promise<ActionResult> {
  const session = await requireUser();
  const user = session?.user;
  if (!user) return { ok: false, error: SESSION_EXPIRED };

  if (!canAction(user.role, "delete_coa")) return { ok: false, error: FORBIDDEN };

  const admin = createAdminClient();

  // Ambil baris dulu: no coa untuk audit + validasi keberadaan.
  const { data: row, error: getErr } = await admin
    .from("coa")
    .select("id, no_coa")
    .eq("id", id)
    .single();
  if (getErr || !row) {
    console.error("[deleteCoaAction] COA tidak ditemukan:", getErr);
    return { ok: false, error: "COA tidak ditemukan." };
  }
  const noCoa = (row as { no_coa: string }).no_coa;

  const { error } = await admin.from("coa").delete().eq("id", id);
  if (error) {
    console.error("[deleteCoaAction] gagal hapus COA:", error);
    await auditFailed(
      user.nama_lengkap,
      "delete_coa_failed",
      `${noCoa} (${id}) ${error.code ?? ""} ${error.message ?? ""}`
    );
    return { ok: false, error: "Gagal menghapus COA. Coba lagi." };
  }

  await logAudit(user.nama_lengkap, `delete_coa: ${noCoa}`, id);
  return { ok: true };
}
