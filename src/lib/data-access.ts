export const READ_TABLES = new Set([
  "master_produk",
  "spesifikasi",
  "hasil_uji",
  "coa",
  "dokumen_arsip",
  "available_hasil_uji",
  "product_spec_versions",
  "inspection_drafts",
]);

/** Never allow client-controlled hosts, schema headers, RPCs, or writes. */
export function dataUrl(
  base: string,
  table: string,
  search: string,
): URL | null {
  if (!READ_TABLES.has(table)) return null;
  const url = new URL(`/rest/v1/${table}`, base);
  url.search = search;
  const selection = url.searchParams.get("select") || "*";
  const plain = selection.replace(
    /master_produk(?:!inner)?\([a-zA-Z_*, ]+\)/g,
    "",
  );
  if (!/^[a-zA-Z0-9_*, ]*$/.test(plain)) return null;

  const limit = Number(url.searchParams.get("limit") ?? 1000);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000) return null;
  url.searchParams.set("limit", String(limit));
  return url;
}
