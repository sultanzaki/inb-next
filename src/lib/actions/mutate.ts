import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { canAction } from "@/lib/types";
import type { z } from "zod";

export type ActionResult = { ok: boolean; error?: string; id?: string };
export async function mutate(
  action: string,
  raw: unknown,
  schema: z.ZodType,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session)
    return { ok: false, error: "Sesi berakhir. Muat ulang halaman." };
  if (!canAction(session.user.role, action))
    return { ok: false, error: "Anda tidak punya izin untuk aksi ini." };
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Data tidak valid.",
    };
  const token = (await cookies()).get("session_token")?.value;
  try {
    const { data, error } = await createAdminClient().rpc("qc_mutate", {
      p_token: token,
      p_action: action,
      p_payload: parsed.data,
    });
    if (error) {
      console.error("[qc_mutate]", { action, code: error.code });
      const messages: Record<string, string> = {
        "23505": "Nomor atau kode sudah digunakan.",
        "23503": "Data masih dirujuk atau referensi tidak valid.",
        P0002: "Data tidak ditemukan atau sudah dihapus.",
        "42501": "Sesi berakhir atau akses tidak diizinkan.",
        "23514":
          "Data tidak memenuhi aturan QC. Periksa spesifikasi dan tanggal.",
        "55000":
          "Data sudah disertifikasi atau spesifikasi telah berubah. Muat ulang data.",
      };
      return {
        ok: false,
        error: messages[error.code] ?? "Gagal menyimpan data. Coba lagi.",
      };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Gagal terhubung ke server. Coba lagi." };
  }
}
