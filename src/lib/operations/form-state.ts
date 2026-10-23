import type { WorkField } from "./catalog";

/** Changing a source invalidates choices scoped to that source, including line items. */
export function clearDependentReferences(
  fields: WorkField[],
  values: Record<string, unknown>,
  changedKey: string,
): Record<string, unknown> {
  const next = { ...values };
  for (const field of fields) {
    if (field.kind === "lines" && Array.isArray(next[field.key])) {
      next[field.key] = (next[field.key] as Record<string, unknown>[]).map(
        (line) =>
          clearDependentReferences(field.fields || [], line, changedKey),
      );
    } else if (
      field.kind === "ref" &&
      Object.values(field.scope || {}).includes("$" + changedKey)
    ) {
      next[field.key] = "";
    }
  }
  return next;
}
