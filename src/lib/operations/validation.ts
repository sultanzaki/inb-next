import { z } from "zod";
import { workCommands, type WorkField } from "./catalog";
function fieldSchema(field: WorkField): z.ZodType {
  if (field.kind === "boolean") return z.boolean();
  if (field.kind === "lines")
    return z
      .array(
        z.object(
          Object.fromEntries(
            (field.fields || []).map((f) => [f.key, fieldSchema(f)]),
          ),
        ),
      )
      .min(field.required ? 1 : 0)
      .max(100);
  if (field.kind === "results")
    return z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          value: z.string().max(500),
        }),
      )
      .max(100);
  let value: z.ZodType;
  if (field.kind === "ref")
    value = z.uuid({ error: `Choose ${field.label.toLowerCase()}.` });
  else if (field.kind === "date") value = z.iso.date();
  else if (field.kind === "select")
    value = z.enum(field.options as [string, ...string[]]);
  else if (field.kind === "number")
    value = z
      .string()
      .regex(
        /^\d{1,12}(\.\d{1,6})?$/,
        "Enter a non-negative number with up to six decimal places.",
      );
  else if (field.kind === "raw")
    value = z
      .string()
      .regex(
        /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/,
        "Enter a number, including scientific notation if needed.",
      );
  else if (field.key === "file_url")
    value = z
      .url()
      .max(2000)
      .refine((v) => {
        const url = new URL(v);
        return url.protocol === "https:" && !url.username && !url.password;
      }, "Use an HTTPS file URL without embedded credentials.");
  else
    value = z
      .string()
      .trim()
      .min(field.required ? (field.key === "reason" ? 3 : 1) : 0)
      .max(field.kind === "textarea" ? 4000 : 200);
  return field.required ? value : z.union([value, z.literal("")]).optional();
}
export function commandSchema(action: string) {
  const command = workCommands[action];
  if (!command) throw Error("Unknown operation.");
  return z.object({
    id: z.union([z.uuid(), z.literal("")]).optional(),
    version: z.number().int().positive().optional(),
    request_key: z.uuid(),
    ...(action === "dispatch_pallet_delivery"
      ? { pallet_id: z.uuid(), pallet_version: z.number().int().positive() }
      : {}),
    ...(action === "repack_pallet"
      ? { destination_version: z.number().int().positive() }
      : {}),
    ...Object.fromEntries(command.fields.map((f) => [f.key, fieldSchema(f)])),
  });
}
export function commandPayload(action: string, raw: unknown) {
  const command = workCommands[action];
  const parsed = commandSchema(action).parse(raw) as Record<string, unknown>;
  if (command.targetField) {
    parsed.id = parsed[command.targetField];
    delete parsed[command.targetField];
  }
  if (action === "create_warehouse_transfer")
    parsed.pallet_ids = ((parsed.pallet_ids as { id: string }[]) || []).map(
      (x) => x.id,
    );
  return parsed;
}
