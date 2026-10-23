import { loadDocumentApproval } from "@/lib/pdf/approval-server";
import { requireUser, logAudit } from "@/lib/auth";
import { authorizedRead } from "@/lib/authorized-read";
import { privateJson } from "@/lib/api-response";
import { erpRpc, erpUxError } from "@/lib/erp/server";
const entities: Record<string, string> = {
  batch: "manufacturing_orders",
  materials: "manufacturing_orders",
  incoming: "incoming_inspections",
  transfer: "warehouse_transfers",
};
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  return authorizedRead(requireUser, async (session) => {
    const { kind, id } = await params;
    if (
      !Object.hasOwn(entities, kind) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return privateJson({ message: "Document not found." }, 404);
    const { data, error } = await erpRpc("erp_work_document", {
      p_entity: entities[kind],
      p_id: id,
    });
    if (error) return erpUxError(error);
    const { renderOperationDocument } = await import("@/lib/operations/pdf");
    const evidence = await loadDocumentApproval(
      entities[kind],
      id,
      String(data.state),
    );
    if (evidence.error)
      return privateJson(
        { message: "Could not verify document approval. Retry." },
        503,
      );
    const bytes = await renderOperationDocument(data, kind, evidence.approval);
    const actor = await session;
    if (!actor) return privateJson({ message: "Session expired." }, 401);
    await logAudit(
      actor.user.nama_lengkap,
      "DOWNLOAD_OPERATION_DOCUMENT",
      `${kind} · ${data.number}`,
    );
    const name = `${kind}-${data.number}`.replace(/[^A-Za-z0-9_-]/g, "_");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename="${name}.pdf"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
