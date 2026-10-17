import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAction } from "@/lib/types";
import { privateJson } from "@/lib/api-response";
import { searchOr } from "@/lib/query-filters";
import { z } from "zod";
const schema = z
  .object({
    id: z.uuid().optional(),
    q: z.string().max(100).default(""),
    from: z.union([z.iso.date(), z.literal("")]).default(""),
    to: z.union([z.iso.date(), z.literal("")]).default(""),
    actor: z.string().max(200).default(""),
    action: z.string().max(100).default(""),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from);
export async function GET(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  if (!canAction(session.user.role, "read_audit"))
    return privateJson({ message: "Access denied." }, 403);
  const p = schema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!p.success) return privateJson({ message: "Invalid filter." }, 400);
  const v = p.data;
  if (v.id) {
    const { data, error } = await createAdminClient()
      .from("audit_log")
      .select("id,waktu,user_name,aksi,referensi,before_data,after_data")
      .eq("id", v.id)
      .single();
    return error
      ? privateJson({ message: "Activity not found." }, 404)
      : privateJson({ data });
  }
  let q = createAdminClient()
    .from("audit_log")
    .select("id,waktu,user_name,aksi,referensi", { count: "exact" })
    .order("waktu", { ascending: false })
    .order("id")
    .range(v.offset, v.offset + 49);
  if (v.q) q = q.or(searchOr(["user_name", "aksi", "referensi"], v.q));
  if (v.actor)
    q = q.ilike("user_name", "%" + v.actor.replace(/[\\%_]/g, "\\$&") + "%");
  if (v.action) q = q.eq("aksi", v.action);
  if (v.from) q = q.gte("waktu", v.from + "T00:00:00+07:00");
  if (v.to) q = q.lte("waktu", v.to + "T23:59:59.999999+07:00");
  const { data, count, error } = await q;
  return error
    ? privateJson({ message: "Could not load the audit log." }, 503)
    : privateJson({ data, count });
}
