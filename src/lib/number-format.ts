/** Format canonical decimal strings without converting them to floating point. */
export function formatDecimal(
  value: string | number | null | undefined,
  {
    locale = "id-ID",
    editing = false,
  }: { locale?: "id-ID" | "en-US"; editing?: boolean } = {},
): string {
  if (value == null) return "—";
  const raw = String(value);
  if (!/^-?\d*(\.\d*)?$/.test(raw)) return raw;
  const [whole, fraction] = raw.split(".");
  const digits = editing ? fraction : fraction?.replace(/0+$/, "");
  const group = locale === "id-ID" ? "." : ",";
  const separator = locale === "id-ID" ? "," : ".";
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) +
    (digits || (editing && fraction !== undefined) ? separator + digits : "")
  );
}
