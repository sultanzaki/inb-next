"use server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import {
  getSessionUser,
  requireUser,
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAction } from "@/lib/types";
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "@/lib/domain/validation";
import type { ActionResult } from "./mutate";

async function manage(
  action: string,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const token = (await cookies()).get("session_token")?.value;
  try {
    const { data, error } = await createAdminClient().rpc("qc_manage_user", {
      p_token: token,
      p_action: action,
      p_payload: payload,
    });
    if (error) {
      console.error("[manage user]", { action, code: error.code });
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Username sudah digunakan."
            : error.code === "23514"
              ? "Perubahan ditolak. Akun sendiri dan administrator terakhir harus tetap aktif."
              : "Perubahan akun gagal. Muat ulang dan coba lagi.",
      };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Tidak dapat terhubung ke server." };
  }
}
export async function saveUserAction(raw: unknown): Promise<ActionResult> {
  const session = await requireUser();
  if (!session || !canAction(session.user.role, "manage_users"))
    return { ok: false, error: "Akses tidak diizinkan." };
  const isUpdate = typeof raw === "object" && raw !== null && "id" in raw;
  if (isUpdate) {
    const p = updateUserSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    return manage("update_user", p.data);
  }
  const p = createUserSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { password, ...rest } = p.data;
  return manage("create_user", {
    ...rest,
    password_hash: await hashPassword(password),
  });
}
export async function resetUserPasswordAction(
  raw: unknown,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session || !canAction(session.user.role, "manage_users"))
    return { ok: false, error: "Akses tidak diizinkan." };
  const p = resetPasswordSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  return manage("reset_password", {
    id: p.data.id,
    password_hash: await hashPassword(p.data.password),
  });
}
export async function changePasswordAction(
  raw: unknown,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user)
    return { ok: false, error: "Sesi berakhir. Silakan masuk kembali." };
  const p = changePasswordSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const limit = await createAdminClient().rpc("qc_reserve_login", {
    p_key: createHash("sha256")
      .update("password-change:" + user.id)
      .digest("hex"),
  });
  if (limit.error || !limit.data)
    return {
      ok: false,
      error:
        "Terlalu banyak percobaan atau layanan belum tersedia. Coba lagi nanti.",
    };
  const { data, error } = await createAdminClient()
    .from("users")
    .select("password_hash")
    .eq("id", user.id)
    .single();
  if (
    error ||
    !data ||
    !(await verifyPassword(p.data.current_password, data.password_hash))
  )
    return { ok: false, error: "Password saat ini tidak sesuai." };
  const newHash = await hashPassword(p.data.password);
  const result = await manage("change_password", {
    expected_hash: data.password_hash,
    password_hash: newHash,
  });
  if (!result.ok) return result;
  try {
    await setSessionCookie(await createSession(user.id, newHash));
  } catch {
    return {
      ok: false,
      error: "Password sudah berubah. Masuk kembali dengan password baru.",
    };
  }
  return { ok: true };
}
