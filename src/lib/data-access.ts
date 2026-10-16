export const READ_TABLES = new Set([
  'master_produk', 'spesifikasi', 'hasil_uji', 'coa', 'dokumen_arsip', 'available_hasil_uji',
]);

/** Never allow client-controlled hosts, schema headers, RPCs, or writes. */
export function dataUrl(base: string, table: string, search: string): URL | null {
  if (!READ_TABLES.has(table)) return null;
  const url = new URL(`/rest/v1/${table}`, base);
  url.search = search;
  const limit = Number(url.searchParams.get('limit') ?? 1000);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000) return null;
  url.searchParams.set('limit', String(limit));
  return url;
}
