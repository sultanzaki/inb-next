import { canAction } from "@/lib/types";
import { moduleGate } from "@/lib/erp/server";
import { requireUser } from "@/lib/auth";
import { dataUrl } from "@/lib/data-access";

async function read(
  request: Request,
  context: { params: Promise<{ table: string }> },
) {
  const session = await requireUser();
  if (!session)
    return Response.json({ message: "Session expired." }, { status: 401 });
  const { table } = await context.params;
  if (
    [
      "hasil_uji",
      "coa",
      "available_hasil_uji",
      "inspection_drafts",
      "dokumen_arsip",
    ].includes(table)
  ) {
    const denied = await moduleGate("quality");
    if (denied) return denied;
  }
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key)
    return Response.json(
      { message: "Database not configured." },
      { status: 503 },
    );
  const target = dataUrl(base, table, new URL(request.url).search);
  if (!target)
    return Response.json({ message: "Query not allowed." }, { status: 400 });
  if (table === "inspection_drafts") {
    if (!canAction(session.user,"save_draft"))
      return Response.json({ message: "Access denied." }, { status: 403 });
    if (!["admin qc", "administrator inbionusa"].includes(session.user.role))
      target.searchParams.set("owner_id", "eq." + session.user.id);
  }
  const headers = new Headers({ apikey: key, Authorization: `Bearer ${key}` });
  for (const name of ["accept", "prefer", "range", "range-unit"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const resultHeaders = new Headers({
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
    for (const name of ["content-type", "content-range", "range-unit"]) {
      const value = upstream.headers.get(name);
      if (value) resultHeaders.set(name, value);
    }
    return new Response(
      request.method === "HEAD" ? null : await upstream.text(),
      { status: upstream.status, headers: resultHeaders },
    );
  } catch {
    return Response.json({ message: "Database unavailable." }, { status: 503 });
  }
}
export const GET = read;
export const HEAD = read;
