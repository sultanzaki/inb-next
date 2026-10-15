// Escape a value for safe interpolation into an HTML template string.
// Covers the five markup-significant characters; everything else passes
// through unchanged. Nullish input becomes an empty string so optional DB
// fields never render the literal string "undefined".
export function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(s ?? "").replace(/[&<>"']/g, (ch) => map[ch]);
}
