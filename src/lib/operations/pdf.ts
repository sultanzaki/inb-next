import { type ApprovalStamp } from "@/lib/pdf/approval";
import { approvalPanel } from "@/lib/pdf/approval-panel";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, degrees, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatDecimal } from "@/lib/number-format";

type Row = Record<string, unknown>;
export const operationDocuments: Record<string, string> = {
  batch: "BATCH MANUFACTURING RECORD",
  materials: "MATERIAL REQUIREMENT & USAGE",
  incoming: "INCOMING MATERIAL INSPECTION",
  transfer: "WAREHOUSE TRANSFER RECORD",
};
const text = (value: unknown) =>
  value == null || value === "" ? "—" : String(value);
const quantity = (value: unknown) =>
  formatDecimal(value == null ? "0" : String(value), { locale: "en-US" });
const rows = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);

/** Uses frozen batch data for closed orders; the authorized RPC selects that snapshot. */
export async function renderOperationDocument(
  row: Row,
  kind: string,
  approval?: ApprovalStamp | null,
) {
  if (!Object.hasOwn(operationDocuments, kind))
    throw Error("Unknown document.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regular, bold, fallback, logo] = await Promise.all([
    pdf.embedFont(
      await readFile(
        path.join(process.cwd(), "src/assets/fonts/DM-Sans-400.ttf"),
      ),
      { subset: true },
    ),
    pdf.embedFont(
      await readFile(
        path.join(process.cwd(), "src/assets/fonts/DM-Sans-600.ttf"),
      ),
      { subset: true },
    ),
    pdf.embedFont(
      await readFile(path.join(process.cwd(), "src/assets/coa/Fallback.ttf")),
      { subset: true },
    ),
    pdf.embedPng(await readFile(path.join(process.cwd(), "public/logo.png"))),
  ]);
  const title = operationDocuments[kind],
    number = text(row.number),
    state = text(row.state);
  const draft =
    kind === "batch" || kind === "materials"
      ? state !== "closed"
      : kind === "incoming"
        ? !["pass", "fail"].includes(state)
        : state === "draft";
  pdf.setTitle(`${title} · ${number}`);
  pdf.setAuthor("PT Inovasi Biokem Nusantara");
  pdf.setCreator("INBIONUSA");
  const ink = rgb(0.12, 0.18, 0.16),
    muted = rgb(0.38, 0.43, 0.41),
    green = rgb(0.02, 0.37, 0.25),
    line = rgb(0.82, 0.86, 0.84);
  const width = 595.28,
    height = 841.89,
    margin = 38,
    contentWidth = width - margin * 2;
  let page!: PDFPage,
    y = 0;
  function fontFor(value: string, strong = false) {
    const font = strong ? bold : regular;
    try {
      font.encodeText(value);
      return font;
    } catch {
      return fallback;
    }
  }
  function wrapped(
    value: string,
    maxWidth: number,
    size: number,
    strong = false,
  ) {
    const out: string[] = [];
    for (const paragraph of value.replace(/\r/g, "").split("\n")) {
      let current = "";
      // Character wrapping also handles unbroken lot numbers, references and URLs.
      for (const char of paragraph) {
        const candidate = current + char;
        if (
          current &&
          fontFor(candidate, strong).widthOfTextAtSize(candidate, size) >
            maxWidth
        ) {
          out.push(current.trimEnd());
          current = char.trimStart();
        } else current = candidate;
      }
      out.push(current || " ");
    }
    return out;
  }
  function draw(
    value: string,
    x: number,
    top: number,
    size = 9,
    strong = false,
    color = ink,
  ) {
    page.drawText(value, {
      x,
      y: top - size,
      size,
      font: fontFor(value, strong),
      color,
    });
  }
  function newPage() {
    page = pdf.addPage([width, height]);
    const logoSize = logo.scaleToFit(62, 45);
    page.drawImage(logo, {
      x: margin,
      y: height - 66,
      width: logoSize.width,
      height: logoSize.height,
    });
    draw(
      "PT INOVASI BIOKEM NUSANTARA",
      margin + 77,
      height - 31,
      10,
      true,
      green,
    );
    draw(
      "CONTROLLED OPERATIONAL RECORD",
      margin + 77,
      height - 47,
      7.5,
      false,
      muted,
    );
    draw(number, margin, height - 87, 10, true);
    const titleLines = wrapped(title, contentWidth, 15, true);
    titleLines.forEach((t, i) =>
      draw(t, margin, height - 107 - i * 19, 15, true),
    );
    y = height - 116 - titleLines.length * 19;
    draw(
      `${draft ? "DRAFT / WORK IN PROGRESS" : "RECORDED / FINALIZED"}   ·   ${state.toUpperCase().replaceAll("_", " ")}   ·   Version ${text(row.version)}`,
      margin,
      y,
      7.5,
      true,
      muted,
    );
    y -= 20;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: green,
    });
    y -= 18;
  }
  function space(required: number) {
    if (y - required < 58) newPage();
  }
  function heading(value: string) {
    space(40);
    draw(value.toUpperCase(), margin, y, 10, true, green);
    y -= 23;
  }
  function paragraph(value: unknown) {
    for (const item of wrapped(text(value), contentWidth, 9)) {
      space(14);
      draw(item, margin, y);
      y -= 14;
    }
    y -= 7;
  }
  function facts(values: [string, unknown][]) {
    for (const [label, value] of values) {
      const lines = wrapped(text(value), contentWidth - 140, 9);
      space(24);
      let labelPage: PDFPage | undefined;
      for (const item of lines) {
        space(15);
        if (labelPage !== page) {
          draw(label, margin, y, 8, false, muted);
          labelPage = page;
        }
        draw(item, margin + 140, y, 9, true);
        y -= 14;
      }
      y -= 9;
    }
    y -= 5;
  }
  function table(headers: string[], body: string[][], ratios: number[]) {
    if (!body.length) {
      paragraph("No recorded transactions.");
      return;
    }
    const widths = ratios.map(
      (r) => (r * contentWidth) / ratios.reduce((a, b) => a + b, 0),
    );
    function header() {
      space(30);
      page.drawRectangle({
        x: margin,
        y: y - 24,
        width: contentWidth,
        height: 24,
        color: rgb(0.93, 0.96, 0.94),
      });
      let x = margin;
      headers.forEach((h, i) => {
        draw(h, x + 6, y - 6, 7.5, true);
        x += widths[i];
      });
      y -= 30;
    }
    header();
    for (const cells of body) {
      const lines = cells.map((v, i) => wrapped(v, widths[i] - 12, 8));
      const maxLines = Math.max(...lines.map((l) => l.length));
      // Split unusually long entries over pages instead of clipping the table.
      for (let offset = 0; offset < maxLines;) {
        if (y - 35 < 58) {
          newPage();
          header();
        }
        const count = Math.min(maxLines - offset, Math.floor((y - 66) / 12));
        let x = margin;
        lines.forEach((items, i) => {
          items
            .slice(offset, offset + count)
            .forEach((v, j) => draw(v, x + 6, y - j * 12, 8));
          x += widths[i];
        });
        y -= count * 12 + 9;
        page.drawLine({
          start: { x: margin, y },
          end: { x: width - margin, y },
          thickness: 0.5,
          color: line,
        });
        y -= 9;
        offset += count;
      }
    }
    y -= 12;
  }
  newPage();
  if (kind === "batch" || kind === "materials") {
    const formula = (row.formula_snapshot || {}) as Row;
    heading("Production identification");
    facts([
      ["Product", row.product],
      ["Production order", number],
      [
        "Formula / revision",
        `${text(formula.number)} / ${text(formula.revision)}`,
      ],
      ["Planned date", row.planned_date],
      [
        "Warehouse / location",
        `${text(row.warehouse)} / ${text(row.location)}`,
      ],
      ["Target output", `${quantity(row.target_quantity)} ${text(row.unit)}`],
    ]);
    heading("Planned material requirements");
    table(
      ["Material", "Usage", "Required", "Tolerance"],
      rows(formula.requirements).map((r) => [
        text(r.material || r.name || r.material_id),
        text(r.role),
        `${quantity(r.required_quantity)} ${text(r.unit)}`,
        `${quantity(r.tolerance_percent)}%`,
      ]),
      [4, 2, 2, 1.5],
    );
    if (rows(row.material_usage).length) {
      heading("Planned versus net actual usage");
      table(
        ["Material", "Planned", "Net used", "Variance"],
        rows(row.material_usage).map((r) => [
          `${text(r.material)} (${text(r.unit)})`,
          quantity(r.required_quantity),
          quantity(r.used_quantity),
          quantity(r.variance_quantity),
        ]),
        [4, 2, 2, 2],
      );
    }
    heading("Actual material use and returns");
    table(
      ["Material / lot", "Operation", "Quantity", "Operator / source"],
      rows(row.inputs).map((r) => [
        `${text(r.material)}\n${text(r.lot)}`,
        text(r.kind),
        `${quantity(r.quantity)} ${text(r.unit)}`,
        `${text(r.operator)}\n${text(r.location)}\n${text(r.created_at)}`,
      ]),
      [3.5, 1.5, 2, 3],
    );
    if (kind === "batch") {
      heading("Finished output");
      table(
        ["Lot / batch", "Output", "MFG / expiry", "QC at snapshot"],
        rows(row.outputs).map((r) => [
          text(r.lot),
          `${quantity(r.quantity)} ${text(row.unit)}`,
          `${text(r.mfg_date)}\n${text(r.expiry_date)}`,
          text(r.quality_status),
        ]),
        [3, 2, 2.5, 2.5],
      );
      heading("Yield and reconciliation");
      facts([
        ["Actual output", `${quantity(row.actual_quantity)} ${text(row.unit)}`],
        ["Yield", `${quantity(row.yield_percent)}%`],
        ["Scrap", `${quantity(row.scrap_quantity)} ${text(row.unit)}`],
        ["Reconciliation", row.closure_reason],
        ["Production notes", row.notes],
        ["Created by", row.created_by_name],
        ["Released by", row.approved_by_name],
        ["Closed by", row.closed_by_name],
        ["Closed at", row.closed_at],
      ]);
      if (rows(row.deviations).length) {
        heading("Production deviations");
        for (const deviation of rows(row.deviations))
          facts([
            [
              "Reference / state",
              `${text(deviation.number)} / ${text(deviation.state)}`,
            ],
            ["Investigation", deviation.investigation],
            ["Disposition", deviation.disposition],
            ["Approved by", deviation.approved_by_name],
          ]);
      }
      paragraph(
        "Finished output remains subject to its separate Quality inspection and COA release. This batch record does not authorize shipment.",
      );
    }
  } else if (kind === "incoming") {
    const spec = (row.spec_snapshot || {}) as Row;
    heading("Material and inspection");
    facts([
      ["Material", row.material],
      ["Supplier lot", row.lot],
      ["Supplier", row.supplier],
      ["Inspection date", row.date],
      [
        "Specification",
        `${text(spec.title)} / revision ${text(spec.revision)}`,
      ],
      ["Result", state.toUpperCase()],
    ]);
    const results = rows(row.results);
    heading("Test results");
    table(
      ["Parameter", "Specification", "Result", "Unit"],
      rows(spec.parameters).map((p) => [
        text(p.name),
        p.kind === "text"
          ? text(p.expected)
          : `${text(p.minimum)} – ${text(p.maximum)}`,
        text(results.find((r) => r.name === p.name)?.value),
        text(p.unit),
      ]),
      [3, 3, 2, 1],
    );
    facts([
      ["Failure explanation", row.failure_reason],
      ["Recorded by", row.created_by_name],
      ["Finalized by", row.approved_by_name],
    ]);
  } else {
    heading("Transfer identification");
    facts([
      ["Transfer date", row.date],
      ["Source", row.source],
      ["Destination", row.destination],
      ["Reason", row.reason],
    ]);
    heading("Dispatch and receipt reconciliation");
    table(
      [
        "Product / lot",
        "Pallet",
        "Dispatched",
        "Received",
        "Missing / pending",
      ],
      rows(row.lines).map((r) => [
        `${text(r.product)}\n${text(r.lot)}\n${text(r.unit)}`,
        text(r.pallet),
        quantity(r.quantity),
        quantity(r.received),
        `${quantity(r.lost)} / ${quantity(r.outstanding)}`,
      ]),
      [3.5, 2, 1.5, 1.5, 2],
    );
    paragraph(
      "Dispatch removes source stock. Destination stock is recognized only for actual received quantities. Outstanding quantities remain in transit; recorded shortages require approval.",
    );
  }
  if (!draft && approval) {
    const panel = approvalPanel(approval, contentWidth, fontFor);
    space(panel.height + 16);
    panel.draw(page, margin, y);
    y -= panel.height + 16;
    pdf.setKeywords(["INBIONUSA", "Internal approval", approval.eventId]);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    if (draft)
      page.drawText("DRAFT", {
        x: 125,
        y: 370,
        size: 75,
        font: bold,
        rotate: degrees(35),
        opacity: 0.07,
        color: green,
      });
    page.drawLine({
      start: { x: margin, y: 44 },
      end: { x: width - margin, y: 44 },
      thickness: 0.5,
      color: line,
    });
    draw(
      `Copyright ${new Date().getFullYear()} PT Inovasi Biokem Nusantara.`,
      margin,
      34,
      7,
      false,
      muted,
    );
    draw(
      `${i + 1} / ${pages.length}`,
      width - margin - 34,
      34,
      7,
      false,
      muted,
    );
  });
  return pdf.save();
}
