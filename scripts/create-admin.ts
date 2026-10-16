/** Explicit bootstrap; password is never stored in source or command arguments. */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, scryptSync } from 'node:crypto';
const { SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD, BOOTSTRAP_NAME } = process.env;
if (!BOOTSTRAP_USERNAME?.trim() || BOOTSTRAP_USERNAME.trim().length > 100 || !BOOTSTRAP_PASSWORD || BOOTSTRAP_PASSWORD.length < 16 || BOOTSTRAP_PASSWORD.length > 1024 || BOOTSTRAP_PASSWORD.trim() === 'INBIONUSA' || !SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Supply BOOTSTRAP_USERNAME, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD (16+ characters), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY securely.');
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString('hex')}$${scryptSync(BOOTSTRAP_PASSWORD, salt, 64).toString('hex')}`;
const admin = createClient((SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL)!, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await admin.from('users').insert({ username: BOOTSTRAP_USERNAME.trim(), nama_lengkap: BOOTSTRAP_NAME || BOOTSTRAP_USERNAME, role: 'administrator inbionusa', password_hash: hash });
if (error) { console.error('Bootstrap failed:', error.code); process.exitCode = 1; }
else console.log('Administrator created. Remove BOOTSTRAP_* variables from environment settings.');
