import { createAdminClient } from './supabase/admin';
import { cookies } from 'next/headers';
import { User } from '@/lib/types';

const SALT = 'INBIO::';
const SESSION_TTL = 60 * 60 * 6; // 6 jam

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(SALT + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

export async function createSession(userId: string): Promise<string> {
  const admin = createAdminClient();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();

  await admin.from('sessions').insert({
    user_id: userId,
    token,
    expires_at: expiresAt,
  });

  return token;
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  const admin = createAdminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .single();

  if (!session || new Date(session.expires_at) < new Date()) {
    return null;
  }

  const { data: user } = await admin
    .from('users')
    .select('id, username, role, nama_lengkap')
    .eq('id', session.user_id)
    .single();

  return user as User | null;
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (token) {
    const admin = createAdminClient();
    await admin.from('sessions').delete().eq('token', token);
  }
  cookieStore.delete('session_token');
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set('session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

export async function logAudit(userName: string, aksi: string, referensi: string = ''): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_log').insert({
      user_name: userName,
      aksi,
      referensi,
    });
  } catch {
    // jangan gagalkan aksi utama
  }
}
