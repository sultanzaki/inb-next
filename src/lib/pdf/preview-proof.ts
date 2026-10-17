import { createHmac, timingSafeEqual } from "node:crypto";
import type { loadCoaSource } from "./coa-source";
import type { z } from "zod";
import type { issueSchema } from "@/lib/domain/validation";
type Form = z.output<typeof issueSchema>;
type Source = Awaited<ReturnType<typeof loadCoaSource>>;
function sign(meta: string, form: Form, source: Source) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("Database not configured.");
  return createHmac("sha256", key)
    .update(JSON.stringify({ meta, form, source }))
    .digest("hex");
}
export function createPreviewProof(form: Form, source: Source) {
  const meta = Buffer.from(
    JSON.stringify({ expires: Date.now() + 15 * 60 * 1000 }),
  ).toString("base64url");
  return meta + "." + sign(meta, form, source);
}
export function verifyPreviewProof(token: string, form: Form, source: Source) {
  try {
    if (token.length > 1024) return false;
    const [meta, signature, ...rest] = token.split(".");
    if (rest.length || !meta || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const data = JSON.parse(Buffer.from(meta, "base64url").toString());
    if (
      typeof data.expires !== "number" ||
      data.expires < Date.now() ||
      data.expires > Date.now() + 16 * 60 * 1000
    )
      return false;
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(sign(meta, form, source), "hex"),
    );
  } catch {
    return false;
  }
}
