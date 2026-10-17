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
            ? "Username already exists."
            : error.code === "23514"
              ? "You cannot deactivate your account or the last administrator."
              : "Could not update the account. Reload and retry.",
      };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
export async function saveUserAction(raw: unknown): Promise<ActionResult> {
  const session = await requireUser();
  if (!session || !canAction(session.user.role, "manage_users"))
    return { ok: false, error: "Access denied." };
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
    return { ok: false, error: "Access denied." };
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
  if (!user) return { ok: false, error: "Session expired. Sign in again." };
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
      error: "Too many attempts or service unavailable. Try again later.",
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
    return { ok: false, error: "Current password is incorrect." };
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
      error: "Password changed. Sign in with your new password.",
    };
  }
  return { ok: true };
}
