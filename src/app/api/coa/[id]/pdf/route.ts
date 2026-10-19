import { moduleGate } from "@/lib/erp/server";
import { requireUser, logAudit } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/domain/validation";
import { renderCoaPdf } from "@/lib/pdf/coa-document";
import type { COA } from "@/lib/types";
import { privateJson } from "@/lib/api-response";
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Session expired." }, 401);
  const denied = await moduleGate("quality");
  if (denied) return denied;
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return privateJson({ message: "Invalid ID." }, 400);
  const { data, error } = await createAdminClient()
    .from("coa")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return privateJson({ message: "COA not found." }, 404);
  if (data.withdrawn)
    return privateJson(
      {
        message:
          "This certificate has been withdrawn. Contact Quality for the current certificate.",
      },
      410,
    );
  if (data.template_version !== "inb-reference-v1")
    return privateJson({ message: "Unsupported template version." }, 422);
  try {
    const bytes = await renderCoaPdf(data as COA);
    await logAudit(session.user.nama_lengkap, "DOWNLOAD_COA", id);
    const filename =
      String(data.no_coa)
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .slice(0, 100) + ".pdf";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return privateJson(
      { message: "Could not create the PDF. Check the certificate data." },
      422,
    );
  }
}
