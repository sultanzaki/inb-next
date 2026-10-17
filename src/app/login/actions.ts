"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyPassword,
  hashPassword,
  upgradePasswordHash,
  createSession,
  setSessionCookie,
  logAudit,
  clearSession,
} from "@/lib/auth";
import { redirect, unstable_rethrow } from "next/navigation";

export type LoginState = { error?: string };

import { createHash } from "node:crypto";

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const rawUsername = formData.get("username");
  const rawPassword = formData.get("password");
  if (typeof rawUsername !== "string" || typeof rawPassword !== "string")
    return { error: "Username and password are required." };
  const username = rawUsername.trim();
  const password = rawPassword;
  if (!username || username.length > 100 || !password || password.length > 1024)
    return { error: "Invalid username or password." };
  const admin = createAdminClient();
  // Reserve atomically BEFORE database lookup/hash work; shared across instances.
  const { data: allowed, error: limitError } = await admin.rpc(
    "qc_reserve_login",
    {
      p_key: createHash("sha256").update(username.toLowerCase()).digest("hex"),
    },
  );
  if (limitError) return { error: "Sign-in is unavailable. Try again later." };
  if (!allowed) return { error: "Too many attempts. Try again later." };

  const { data: users, error: userError } = await admin
    .from("users")
    .select(
      "id, username, password_hash, role, nama_lengkap, is_active, must_change_password",
    )
    .eq("username", username)
    .limit(1);

  const user = users && users.length > 0 ? users[0] : null;
  // Equalize scrypt cost: user tidak ada tetap membakar kerja hash yang setara,
  // supaya waktu respons tidak membocorkan keberadaan username.
  let valid = false;
  if (user?.is_active) {
    valid = await verifyPassword(password, user.password_hash);
  } else {
    await hashPassword(password);
  }

  if (userError || !user || !valid) {
    await logAudit(
      username,
      "login_failed",
      userError ? "db_error" : "invalid_credentials",
    );
    // Pesan seragam: jangan bocorkan apakah username ada / DB bermasalah.
    return { error: "Incorrect username or password." };
  }

  let token: string;
  try {
    token = await createSession(user.id, user.password_hash);
  } catch {
    return {
      error: "Account changed or service unavailable. Sign in again.",
    };
  }
  // Compare-and-set prevents a concurrent reset from being overwritten.
  if (!user.password_hash.startsWith("scrypt$")) {
    await upgradePasswordHash(user.id, password, user.password_hash);
  }

  await setSessionCookie(token);
  await logAudit(user.nama_lengkap, "LOGIN", username);

  redirect(user.must_change_password ? "/account/password" : "/");
}

export async function logoutAction(): Promise<{ ok: boolean }> {
  try {
    await clearSession();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false };
  }
}
