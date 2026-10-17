import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { canAction } from "@/lib/types";
import type { z } from "zod";

export type ActionResult = { ok: boolean; error?: string; id?: string };
export async function mutate(
  action: string,
  raw: unknown,
  schema: z.ZodType,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session)
    return { ok: false, error: "Session expired. Reload the page." };
  if (!canAction(session.user.role, action))
    return { ok: false, error: "You cannot perform this action." };
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid data.",
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
      const messages: Record<string, string> = {
        "23505": "This number or code is already used.",
        "23503":
          "This record is referenced elsewhere or its reference is invalid.",
        P0002: "Record not found or already deleted.",
        "42501": "Session expired or access denied.",
        "23514": "Check the specifications and dates.",
        "55000":
          "Results are certified or specifications changed. Reload the data.",
      };
      return {
        ok: false,
        error: messages[error.code] ?? "Could not save changes. Retry.",
      };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Could not reach the server. Retry." };
  }
}
