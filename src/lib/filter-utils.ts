// Escape a raw search term for a PostgREST .or() ilike filter. Two escape
// levels apply: PostgREST strips one backslash level inside double-quoted
// values (" -> \" and \ -> \\), then Postgres LIKE consumes one more
// (\ escapes % and _). The caller must place the returned term inside double
// quotes in the filter itself (e.g. nama.ilike."%term%"), because the
// PostgREST grammar treats , and ) as syntax only in bare values — a quoted
// value keeps them literal (a bare value like "%a,b%" would truncate at the
// comma -> PGRST100 400).
export function escapeOrTerm(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
