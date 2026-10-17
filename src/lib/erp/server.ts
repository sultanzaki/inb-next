import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/api-response";
import type { ModuleKey } from "./schema";
export async function erpRpc(name: string, args: Record<string, unknown> = {}) {
  const token = (await cookies()).get("session_token")?.value;
  return createAdminClient().rpc(name, { p_token: token ?? "", ...args });
}
export async function moduleGate(module: ModuleKey, verb = "read") {
  const { error } = await erpRpc("erp_module_guard", {
    p_module: module,
    p_verb: verb,
  });
  return error ? erpError(error) : null;
}
export function erpError(error: { code?: string; message?: string }) {
  const code = error.code;
  const message =
    code === "42501"
      ? "Module unavailable or access denied."
      : code === "P0001"
        ? error.message
        : code === "23505"
          ? "This code or reference already exists."
          : code === "23503"
            ? "This record is referenced elsewhere or its reference is missing."
            : code === "P0002"
              ? "Record not found."
              : code === "23514" ||
                  code === "23502" ||
                  code === "22P02" ||
                  code === "22007"
                ? "Check required fields, quantities, and dates."
                : "Workspace unavailable. Check the ERP migration and retry.";
  return privateJson(
    { message },
    code === "42501"
      ? 403
      : code === "P0002"
        ? 404
        : code === "23505"
          ? 409
          : code === "P0001" || code?.startsWith("23") || code?.startsWith("22")
            ? 422
            : 503,
  );
}
