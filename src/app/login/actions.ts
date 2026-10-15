"use server";

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyPassword,
  hashPassword,
  upgradePasswordHash,
  createSession,
  setSessionCookie,
  logAudit,
} from '@/lib/auth';
import { redirect } from 'next/navigation';

export type LoginState = { error?: string };

// Rate limit in-process per username: blokir setelah 5 kegagalan / 15 menit.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10_000; // batasi ukuran Map: cegah memory DoS via flooding username unik
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(username: string): boolean {
  const entry = attempts.get(username);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(username);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(username: string): void {
  const now = Date.now();
  const entry = attempts.get(username);
  if (!entry || now > entry.resetAt) {
    // Evict entri tertua (urutan insert) saat Map penuh, agar tetap bounded.
    if (!attempts.has(username) && attempts.size >= MAX_ENTRIES) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    attempts.set(username, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = (formData.get('username') as string | null)?.trim() ?? '';
  // Password tidak di-trim: hash apa adanya sesuai input pengguna.
  const password = (formData.get('password') as string | null) ?? '';

  if (!username || !password) {
    return { error: 'Username dan password wajib diisi.' };
  }

  if (isRateLimited(username)) {
    return { error: 'Terlalu banyak percobaan. Coba lagi nanti.' };
  }

  const admin = createAdminClient();

  const { data: users, error: userError } = await admin
    .from('users')
    .select('id, username, password_hash, role, nama_lengkap')
    .eq('username', username)
    .limit(1);

  const user = users && users.length > 0 ? users[0] : null;
  // Equalize scrypt cost: user tidak ada tetap membakar kerja hash yang setara,
  // supaya waktu respons tidak membocorkan keberadaan username.
  let valid = false;
  if (user) {
    valid = await verifyPassword(password, user.password_hash);
  } else {
    await hashPassword(password);
  }

  if (userError || !user || !valid) {
    recordFailure(username);
    await logAudit(username, 'login_failed', userError ? 'db_error' : 'invalid_credentials');
    // Pesan seragam: jangan bocorkan apakah username ada / DB bermasalah.
    return { error: 'Username atau password salah.' };
  }

  // Upgrade transparan hash legacy -> scrypt.
  if (!user.password_hash.startsWith('scrypt$')) {
    await upgradePasswordHash(user.id, password);
  }

  const token = await createSession(user.id);
  attempts.delete(username);
  await setSessionCookie(token);
  await logAudit(user.nama_lengkap, 'LOGIN', username);

  redirect('/');
}

export async function logoutAction() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;

  if (token) {
    const admin = createAdminClient();
    await admin.from('sessions').delete().eq('token', token);
  }

  cookieStore.delete('session_token');
  redirect('/login');
}
