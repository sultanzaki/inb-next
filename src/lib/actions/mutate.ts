import { qcMutationError } from "@/lib/domain/qc-errors";
import { validationFields, humanLabel, type FieldError } from "@/lib/erp/ux";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { canAction } from "@/lib/types";
import type { z } from "zod";

export type ActionResult = {
  ok: boolean;
  error?: string;
  fields?: FieldError[];
  id?: string;
};
export async function mutate(
  action: string,
  raw: unknown,
  schema: z.ZodType,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session)
    return { ok: false, error: "Session expired. Reload the page." };
  if (!canAction(session.user, action))
    return { ok: false, error: "You cannot perform this action." };
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: validationFields(parsed.error.issues)
        .map((i) => humanLabel(i.path) + ": " + i.message)
        .join(" "),
      fields: validationFields(parsed.error.issues),
    };
  const token = (await cookies()).get("session_token")?.value;
  try {
    const { data, error } = await createAdminClient().rpc("qc_mutate", {
      p_token: token,
      p_action: action,
      p_payload: parsed.data,
    });
    if (error) {
      console.error("[qc_mutate]", { action, code: error.code });
      return {
        ok: false,
        error: qcMutationError(error.code, error.message),
      };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Could not reach the server. Retry." };
  }
}
