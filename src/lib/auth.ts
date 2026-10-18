import { createAdminClient } from "./supabase/admin";
import { cookies } from "next/headers";
import { User } from "@/lib/types";
import { hashPassword } from "./password";
export { hashPassword, verifyPassword } from "./password";
const SESSION_TTL = 60 * 60 * 6;

/**
 * Upgrade transparan: setelah verifikasi legacy berhasil, simpan ulang hash
 * sebagai scrypt. Kegagalan upgrade tidak boleh menggagalkan login.
 */
export async function upgradePasswordHash(
  userId: string,
  password: string,
  expectedHash: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const hashed = await hashPassword(password);
    const { error } = await admin
      .from("users")
      .update({ password_hash: hashed })
      .eq("id", userId)
      .eq("password_hash", expectedHash);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[auth] gagal upgrade hash password:", err);
  }
}

export async function createSession(
  userId: string,
  expectedHash?: string,
): Promise<string> {
  const admin = createAdminClient();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();

  if (expectedHash) {
    const { data, error } = await admin.rpc("qc_create_login_session", {
      p_user_id: userId,
      p_expected_hash: expectedHash,
      p_token: token,
      p_expires: expiresAt,
    });
    if (error || !data) throw new Error("Account changed. Sign in again.");
    return token;
  }
  const { error } = await admin.from("sessions").insert({
    user_id: userId,
    token,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Gagal membuat sesi: ${error.message}`);

  return token;
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;
  if (
    !token ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    return null;

  const admin = createAdminClient();

  // NB: tanpa `new Date()` di sini — fungsi ini jalan di render path layout,
  // dan Cache Components menolak nilai unstable (new Date) saat prerender.
  // Expired sessions disaring lewat Postgres ('now' dievaluasi DB), purge
  // periodik dilakukan lewat purgeExpiredSessions() dari login action.
  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .gt("expires_at", "now")
    .single();

  if (sessionError || !session) return null;

  const { data: user, error: userError } = await admin
    .from("users")
    .select("id, username, role, nama_lengkap, is_active, must_change_password")
    .eq("id", session.user_id)
    .eq("is_active", true)
    .single();

  if (userError || !user) return null;
  if (!user.must_change_password) {
    const { data: access } = await admin.rpc("erp_permissions", {
      p_token: token,
    });
    if (Array.isArray(access))
      return { ...user, effective_actions: access } as User;
    if (
      ![
        "admin qc",
        "administrator inbionusa",
        "qc supervisor",
        "viewer",
      ].includes(user.role)
    )
      return { ...user, effective_actions: [] } as User;
  }
  return user as User;
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;
  if (token) {
    const admin = createAdminClient();
    const { error } = await admin.from("sessions").delete().eq("token", token);
    if (error) throw new Error("Could not revoke the session. Sign out again.");
  }
  cookieStore.delete("session_token");
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("session_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL,
    path: "/",
  });
}

/**
 * Utilitas untuk server action terproteksi: kembalikan `{ user }` bila ada
 * sesi valid, atau `null` bila tidak (pemanggil biasanya redirect ke /login).
 */
export async function requireUser(): Promise<{ user: User } | null> {
  const user = await getSessionUser();
  if (!user || user.must_change_password) return null;
  return { user };
}

/**
 * Housekeeping sesi kedaluwarsa — dipanggil dari login action (bukan dari
 * render path: `new Date()` di sana ditolak Cache Components saat prerender;
 * `.lt('expires_at', 'now')` dievaluasi Postgres, bukan JS).
 */
export async function purgeExpiredSessions(): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("sessions")
      .delete()
      .lt("expires_at", "now");
    if (error) console.error("[sessions] cleanup gagal", { code: error.code });
  } catch {
    // housekeeping saja — jangan ganggu alur utama
  }
}

export async function logAudit(
  userName: string,
  aksi: string,
  referensi: string = "",
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_log").insert({
      user_name: userName,
      aksi,
      referensi,
    });
    if (error) console.error("[audit] gagal dicatat", { code: error.code });
  } catch {
    console.error("[audit] database tidak dapat dihubungi");
    // Business mutations have transactional SQL audit; login audit is best effort.
  }
}
