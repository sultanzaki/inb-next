/**
 * Helper bersama untuk server actions. File ini sengaja BUKAN modul
 * "use server" — hanya guard murni, sehingga aman diimpor dari semua
 * file aksi (modul "use server" hanya boleh mengekspor fungsi async).
 */

// UUID v1-v8 (hex, dash-delimited 8-4-4-4-12), case-insensitive.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validasi format UUID untuk id yang datang dari payload client.
 * Return pesan error (Indonesia) bila tidak valid, null bila OK.
 * Pola pemakaian: `const err = assertUuid(x); if (err) return { ok: false, error: err };`
 */
export function assertUuid(id: string): string | null {
  return UUID_RE.test(id) ? null : "ID tidak valid.";
}
