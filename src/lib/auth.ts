import { createAdminClient } from './supabase/admin';
import { cookies } from 'next/headers';
import { User } from '@/lib/types';
import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const LEGACY_PREFIX = 'INBIO::';
const SESSION_TTL = 60 * 60 * 6; // 6 jam
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;

const scrypt = promisify(nodeScrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Hash password baru: scrypt (parameter default Node) dengan salt acak 16 byte
 * dan key 64 byte. Format tersimpan: `scrypt$<saltHex>$<hashHex>`.
 * Password TIDAK di-trim: karakter apa pun yang diketik pengguna ikut di-hash.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEY_BYTES);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifikasi password terhadap hash tersimpan.
 * - Format scrypt: bandingkan pakai timingSafeEqual (konstanta waktu).
 * - Legacy (sha256 'INBIO::' + password): dicoba apa adanya, lalu varian
 *   trimmed (baris lama pernah dibuat dari input yang di-trim).
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length === 0) return false;

    const derived = await scrypt(password, salt, expected.length);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  const legacyHash = (pw: string) =>
    createHash('sha256').update(LEGACY_PREFIX + pw).digest('hex');

  return legacyHash(password) === stored || legacyHash(password.trim()) === stored;
}

/**
 * Upgrade transparan: setelah verifikasi legacy berhasil, simpan ulang hash
 * sebagai scrypt. Kegagalan upgrade tidak boleh menggagalkan login.
 */
export async function upgradePasswordHash(
  userId: string,
  password: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const hashed = await hashPassword(password);
    const { error } = await admin
      .from('users')
      .update({ password_hash: hashed })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[auth] gagal upgrade hash password:', err);
  }
}

export async function createSession(userId: string): Promise<string> {
  const admin = createAdminClient();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();

  const { error } = await admin.from('sessions').insert({
    user_id: userId,
    token,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Gagal membuat sesi: ${error.message}`);

  return token;
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  const admin = createAdminClient();

  // NB: tanpa `new Date()` di sini — fungsi ini jalan di render path layout,
  // dan Cache Components menolak nilai unstable (new Date) saat prerender.
  // Expired sessions disaring lewat Postgres ('now' dievaluasi DB), purge
  // periodik dilakukan lewat purgeExpiredSessions() dari login action.
  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .gt('expires_at', 'now')
    .single();

  if (sessionError || !session) return null;

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, username, role, nama_lengkap')
    .eq('id', session.user_id)
    .single();

  if (userError || !user) return null;
  return user as User;
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

/**
 * Utilitas untuk server action terproteksi: kembalikan `{ user }` bila ada
 * sesi valid, atau `null` bila tidak (pemanggil biasanya redirect ke /login).
 */
export async function requireUser(): Promise<{ user: User } | null> {
  const user = await getSessionUser();
  if (!user) return null;
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
    await admin.from('sessions').delete().lt('expires_at', 'now');
  } catch {
    // housekeeping saja — jangan ganggu alur utama
  }
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
