import { requireUser } from "@/lib/auth";
import { erpRpc, erpError } from "@/lib/erp/server";
import { privateJson } from "@/lib/api-response";
import { displayNumber } from "@/lib/erp/ux";
import { workHref } from "@/lib/operations/catalog";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireUser()))
    return privateJson({ message: "Session expired." }, 401);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return privateJson({ message: "Choose a pallet." }, 400);
  const { data, error } = await erpRpc("erp_work_read", {
    p_entity: "pallets",
    p_query: { id },
  });
  if (error) return erpError(error);
  const pallet = data.rows[0];
  if (!pallet)
    return privateJson({ message: "Pallet not found or access denied." }, 404);
  const { default: QRCode } = await import("qrcode");
  const qr = await QRCode.toString(
    new URL(workHref("pallets", id), request.url).href,
    { type: "svg", margin: 1, errorCorrectionLevel: "M" },
  );
  const escape = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
  const rows = (pallet.contents as Record<string, unknown>[])
    .map(
      (row) =>
        `<tr><td>${escape(row.product)}</td><td>${escape(row.lot)}</td><td>${escape(displayNumber(String(row.quantity)))} ${escape(row.unit)}</td></tr>`,
    )
    .join("");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(pallet.number)} | INBIONUSA pallet label</title><style>body{font:14px Arial,sans-serif;margin:28px;color:#172d23}main{max-width:850px;margin:auto;border:2px solid #047857;padding:22px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}img{width:90px}h1{font-size:28px;margin:12px 0}p{margin:6px 0}.qr{width:150px;flex-shrink:0}.qr svg{width:100%;height:auto}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;border-bottom:1px solid #cad6ce;padding:10px 5px;overflow-wrap:anywhere}small{color:#576b5e}button{margin-bottom:20px;padding:10px 18px;background:#047857;color:white;border:0;border-radius:5px;cursor:pointer}@media print{@page{margin:12mm}body{margin:0}button{display:none}main{break-inside:avoid}thead{display:table-header-group}}</style></head><body><button onclick="window.print()">Print pallet label</button><main><header><div><img src="/logo.png" alt="INBIONUSA"><h1>${escape(pallet.number)}</h1><p>${escape(pallet.warehouse || "In transit")} · ${escape(pallet.location || "Location pending receipt")}</p><p>Status: ${escape(pallet.state)}</p></div><div class="qr">${qr}</div></header><table><thead><tr><th>Product / material</th><th>Lot / batch</th><th>Quantity</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No packed contents. Check the current record before use.</td></tr>'}</tbody></table><small>Scan to open the current pallet record. Printed content is a snapshot and may change after repacking.<br>Copyright ${new Date().getFullYear()} PT Inovasi Biokem Nusantara.</small></main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
