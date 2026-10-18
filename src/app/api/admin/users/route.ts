import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAction } from "@/lib/types";
import { searchOr } from "@/lib/query-filters";
import { privateJson } from "@/lib/api-response";
export async function GET(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  if (!canAction(session.user, "manage_users"))
    return privateJson({ message: "Access denied." }, 403);
  const params = new URL(request.url).searchParams,
    q = (params.get("q") || "").slice(0, 100),
    offset = Number(params.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    return privateJson({ message: "Invalid page." }, 400);
  let query = createAdminClient()
    .from("users")
    .select(
      "id,username,role,nama_lengkap,is_active,must_change_password,created_at,updated_at",
      { count: "exact" },
    )
    .order("nama_lengkap")
    .order("id")
    .range(offset, offset + 49);
  if (q) query = query.or(searchOr(["username", "nama_lengkap"], q));
  const { data, count, error } = await query;
  return error
    ? privateJson({ message: "Could not load users." }, 503)
    : privateJson({ data, count });
}
