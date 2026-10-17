import { requireUser } from "@/lib/auth";
import { canAction } from "@/lib/types";
import { loadCoaSource, createPreviewProof } from "@/lib/pdf/coa-source";
import { issueSchema } from "@/lib/domain/validation";
import { renderCoaPdf } from "@/lib/pdf/coa-document";
import { privateJson } from "@/lib/api-response";
export const maxDuration = 60;
export async function POST(request: Request) {
  const session = await requireUser();
  if (!session) return privateJson({ message: "Sesi berakhir." }, 401);
  if (!canAction(session.user.role, "issue_coa"))
    return privateJson({ message: "Akses tidak diizinkan." }, 403);
  let body;
  try {
    if (Number(request.headers.get("content-length")) > 32768)
      return privateJson({ message: "Payload terlalu besar." }, 413);
    body = await request.json();
  } catch {
    return privateJson({ message: "Data tidak valid." }, 400);
  }
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success)
    return privateJson({ message: parsed.error.issues[0].message }, 422);
  const form = parsed.data;
  try {
    const source = await loadCoaSource(form);
    const bytes = await renderCoaPdf(source.document, { preview: true });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="COA-preview.pdf"',
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "X-COA-Preview-Token": createPreviewProof(form, source),
      },
    });
  } catch (e) {
    return privateJson(
      {
        message:
          e instanceof Error
            ? e.message
            : "Pratinjau gagal dibuat. Periksa panjang parameter dan hasil.",
      },
      422,
    );
  }
}
