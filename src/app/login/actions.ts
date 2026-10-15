"use server";

import { createAdminClient } from '@/lib/supabase/admin';
import { hashPassword, createSession, setSessionCookie, logAudit } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function loginAction(formData: FormData) {
  const username = (formData.get('username') as string)?.trim();
  const password = (formData.get('password') as string)?.trim();

  if (!username || !password) return;

  const admin = createAdminClient();

  const { data: users } = await admin
    .from('users')
    .select('id, username, password_hash, role, nama_lengkap')
    .eq('username', username)
    .limit(1);

  if (!users || users.length === 0) return;

  const user = users[0];
  const hashed = await hashPassword(password);

  if (user.password_hash !== hashed) return;

  const token = await createSession(user.id);
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
