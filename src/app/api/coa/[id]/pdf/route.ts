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
  if (!session) return privateJson({ message: "Sesi berakhir." }, 401);
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return privateJson({ message: "ID tidak valid." }, 400);
  const { data, error } = await createAdminClient()
    .from("coa")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data)
    return privateJson({ message: "COA tidak ditemukan." }, 404);
  if (data.template_version !== "inb-reference-v1")
    return privateJson({ message: "Versi template belum didukung." }, 422);
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
      { message: "PDF gagal dibuat. Periksa data sertifikat." },
      422,
    );
  }
}
