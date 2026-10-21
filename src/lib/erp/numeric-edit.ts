import { displayNumber, parseNumberInput } from "./ux";

/** Database/transport values use a decimal point, never grouping separators. */
export function numericDisplay(value: string | number): string {
  return displayNumber(value);
}

/** Localized text is only a view. Regroup incomplete separators during native edits. */
export function numericEdit(text: string, caret: number, nativeEdit = false) {
  const cleaned = text
    .trim()
    .replace(/^(Rp|IDR)\s*/i, "")
    .replace(/[\s\u00a0]/g, "");
  const parsed =
    nativeEdit && /^-?[\d.]*(?:,\d*)?$/.test(cleaned)
      ? cleaned.replaceAll(".", "").replace(",", ".")
      : parseNumberInput(text);
  if (parsed === null) return { text, value: text, caret, valid: false };
  let canonical = parsed.replace(/^(-?)0+(?=\d)/, "$1");
  if (canonical.startsWith(".")) canonical = "0" + canonical;
  if (canonical.startsWith("-.")) canonical = "-0" + canonical.slice(1);
  const formatted = displayNumber(canonical, { editing: true });
  // Count meaningful characters, not grouping marks, to preserve a mid-number cursor.
  const prefix = text
    .slice(0, caret)
    .replace(/^(Rp|IDR)\s*/i, "")
    .replace(/[.\s\u00a0]/g, "");
  const removedZeros = Math.max(
    0,
    cleaned.replaceAll(".", "").length - canonical.length,
  );
  const insertedZero = /^-?,/.test(cleaned) && prefix.includes(",") ? 1 : 0;
  const wanted = Math.max(0, prefix.length - removedZeros + insertedZero);
  let position = 0,
    seen = 0;
  while (position < formatted.length && seen < wanted) {
    if (formatted[position] !== ".") seen++;
    position++;
  }
  if (caret === text.length) position = formatted.length;
  return {
    text: formatted,
    value: canonical.endsWith(".") ? canonical.slice(0, -1) : canonical,
    caret: position,
    valid: canonical !== "-",
  };
}
