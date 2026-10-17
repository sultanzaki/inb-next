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

// Keep a rounded display from claiming complete compliance when a lot failed.
export function formatPassRate(passed: number, total: number): string {
  if (total <= 0) return "—";
  const value = new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 2,
  }).format((passed / total) * 100);
  return passed < total && value === "100" ? "<100" : value;
}
