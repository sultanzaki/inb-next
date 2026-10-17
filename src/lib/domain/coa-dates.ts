/** One calendar year, clamped to February 28 for leap-day manufacturing. */
export function coaExpiryDate(mfg: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mfg)) return "";
  const original = new Date(mfg + "T00:00:00Z");
  if (
    !Number.isFinite(original.getTime()) ||
    original.toISOString().slice(0, 10) !== mfg
  )
    return "";
  const year = original.getUTCFullYear() + 1;
  if (year > 9999) return "";
  const month = original.getUTCMonth();
  const day = Math.min(
    original.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
