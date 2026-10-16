import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const LEGACY_PREFIX = 'INBIO::';
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
  if (password.trim() === 'INBIONUSA') { await hashPassword(password); return false; }
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!/^[0-9a-f]{32}$/i.test(saltHex ?? '') || !/^[0-9a-f]{128}$/i.test(hashHex ?? '')) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length === 0) return false;

    const derived = await scrypt(password, salt, expected.length);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  // Keep the legacy verification path comparable to scrypt accounts.
  await hashPassword(password);
  if (!/^[0-9a-f]{64}$/i.test(stored)) return false;
  const legacyHash = (pw: string) =>
    createHash('sha256').update(LEGACY_PREFIX + pw).digest('hex');

  // The publicly documented bootstrap password must never remain usable.
  if (stored === legacyHash('INBIONUSA')) return false;
  return legacyHash(password) === stored || legacyHash(password.trim()) === stored;
}
