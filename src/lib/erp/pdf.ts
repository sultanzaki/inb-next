import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { decimal, type ERPRow, type ERPLine } from "./schema";
type Snapshot = {
  number: string;
  date: string;
  due_date?: string;
  related_number?: string;
  external_reference?: string;
  revision?: number;
  valid_until?: string;
  currency?: string;
  customer?: {
    name?: string;
    billing_address?: string;
    address?: string;
    shipping_address?: string;
    contact?: string;
    email?: string;
    phone?: string;
  };
  lines: ERPLine[];
  terms?: string;
  delivery_terms?: string;
  lead_time?: string;
  tax_rate?: string;
  totals?: Record<string, string>;
  reason?: string;
  kind?: string;
  from_location?: string;
  to_location?: string;
  order_number?: string;
  posted_by?: string;
  issuer?: string;
  notes?: string;
};
export async function renderERPDocument(
  row: ERPRow & { notes?: string; amount?: string },
  type: "quotation" | "movement" | "purchase" | "finance",
) {
  const purchase = type === "purchase",
    finance = type === "finance",
    quote = type === "quotation" || purchase || finance,
    draft = quote
      ? ["draft", "pending"].includes(row.state || "")
      : row.state === "draft";
  const data = (
    (row.state === "draft" && !finance) || !row.snapshot
      ? {
          ...row,
          from_location: row.source || row.from_location,
          to_location: row.destination || row.to_location,
          customer:
            (row as ERPRow & { customer_data?: Snapshot["customer"] })
              .customer_data ??
            (row.customer ? { name: row.customer } : undefined),
        }
      : row.snapshot
  ) as Snapshot;
  const pdf = await PDFDocument.create();
  const kind = String(row.kind || data.kind || "invoice");
  const titles: Record<string, string> = {
    invoice: "INVOICE",
    payment_request: "PAYMENT REQUEST",
    supplier_request: "SUPPLIER PAYMENT REQUEST",
    supplier_bill: "SUPPLIER BILL",
    credit_note: "CREDIT NOTE",
    supplier_credit: "SUPPLIER CREDIT",
  };
  const title = finance
    ? titles[kind] || "FINANCIAL DOCUMENT"
    : purchase
      ? "PURCHASE ORDER"
      : quote
        ? "QUOTATION"
        : data.kind === "delivery"
          ? "DELIVERY ORDER"
          : data.kind === "production"
            ? "PRODUCTION RECORD"
            : "STOCK MOVEMENT";
  const number = String(data.number || row.number || "Unnumbered draft");
  const currency = data.currency || row.currency || "";
  const summaryOnly = finance && !(data.lines || []).length;
  pdf.setTitle(`${title} · ${number}`);
  pdf.setAuthor("PT Inovasi Biokem Nusantara");
  pdf.setCreator("INBIONUSA");
  pdf.setSubject("Official commercial and operational document");
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
  const supported = new Set(regular.getCharacterSet()),
    fallbackSupported = new Set(fallback.getCharacterSet());
  const ink = rgb(15 / 255, 23 / 255, 42 / 255),
    muted = rgb(91 / 255, 107 / 255, 124 / 255),
    brand = rgb(6 / 255, 95 / 255, 70 / 255),
    border = rgb(228 / 255, 232 / 255, 236 / 255);
  let page!: PDFPage,
    y = 0;
  function runs(s: string, strong = false) {
    const items: { text: string; font: PDFFont }[] = [];
    for (const ch of s.replace(/[\t\r]/g, " ")) {
      const font = supported.has(ch.codePointAt(0)!)
        ? strong
          ? bold
          : regular
        : fallback;
      const c =
        font === fallback && !fallbackSupported.has(ch.codePointAt(0)!)
          ? "□"
          : ch;
      const last = items.at(-1);
      if (last?.font === font) last.text += c;
      else items.push({ text: c, font });
    }
    return items;
  }
  function width(s: string, size = 9, strong = false) {
    return runs(s, strong).reduce(
      (n, r) => n + r.font.widthOfTextAtSize(r.text, size),
      0,
    );
  }
  function draw(
    s: string,
    x: number,
    at: number,
    size = 9,
    strong = false,
    color = ink,
  ) {
    for (const run of runs(s, strong)) {
      page.drawText(run.text, { x, y: at, size, font: run.font, color });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  }
  function wrap(s: string, max: number, size = 9, strong = false) {
    const result: string[] = [];
    for (const paragraph of String(s || "—").split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (width(current + (current ? " " : "") + word, size, strong) <= max) {
          current += (current ? " " : "") + word;
          continue;
        }
        if (current) result.push(current);
        current = "";
        for (const ch of word) {
          if (current && width(current + ch, size, strong) > max) {
            result.push(current);
            current = "";
          }
          current += ch;
        }
      }
      result.push(current);
    }
    return result;
  }
  function rule(at: number, color = border, thickness = 0.5) {
    page.drawLine({
      start: { x: 40, y: at },
      end: { x: 555, y: at },
      thickness,
      color,
    });
  }
  function sheet() {
    page = pdf.addPage([595.28, 841.89]);
    page.drawImage(logo, { x: 40, y: 780, width: 43, height: 43 });
    draw("INBIONUSA", 94, 805, 15, true, brand);
    draw("PT INOVASI BIOKEM NUSANTARA", 94, 788, 8, true, muted);
    const heading = wrap(title, 225, 12, true);
    heading.forEach((line, i) =>
      draw(line, 555 - width(line, 12, true), 811 - i * 15, 12, true, brand),
    );
    const references = wrap(number, 225, 8.5, true);
    references.forEach((line, i) =>
      draw(line, 555 - width(line, 8.5, true), 777 - i * 11, 8.5, true),
    );
    const headerBottom = Math.min(760, 777 - (references.length - 1) * 11 - 12);
    rule(headerBottom, brand, 1.3);
    draw(
      draft
        ? "DRAFT / NOT ISSUED"
        : String(row.state || "")
            .replaceAll("_", " ")
            .toUpperCase(),
      40,
      headerBottom - 13,
      7.5,
      true,
      muted,
    );
    y = headerBottom - 34;
    if (draft)
      page.drawText("DRAFT", {
        x: 140,
        y: 330,
        size: 80,
        font: bold,
        color: brand,
        opacity: 0.06,
        rotate: degrees(45),
      });
  }
  function ensure(height: number) {
    if (y - height < 55) sheet();
  }
  function paragraph(text: string, strong = false, size = 9) {
    if (strong) ensure(45);
    for (const line of wrap(text, 515, size, strong)) {
      ensure(15);
      draw(line, 40, y, size, strong);
      y -= 15;
    }
    y -= 5;
  }
  sheet();
  const dueDate = String(row.due_date || data.due_date || "");
  const metadata = [
    ["Document date", data.date || row.date || "—"],
    ...(purchase ? [["Expected receipt", data.valid_until || "—"]] : []),
    ...(type === "quotation"
      ? [
          ["Revision", String(data.revision || 1)],
          ["Valid until", data.valid_until || "—"],
        ]
      : []),
    ...(finance && dueDate ? [["Due date", dueDate]] : []),
    ...(currency && quote ? [["Currency", currency]] : []),
    ...(data.order_number
      ? [[purchase ? "Reference" : "Source order", data.order_number]]
      : []),
    ...(data.related_number ? [["Corrects", data.related_number]] : []),
    ...(data.external_reference
      ? [["External reference", data.external_reference]]
      : []),
  ];
  const party = data.customer;
  const partyText = [
    party?.name || "",
    (quote ? party?.billing_address : party?.shipping_address) ||
      party?.billing_address ||
      party?.address ||
      "",
    party?.contact ? "Attention: " + party.contact : "",
    [party?.email, party?.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);
  if (!party) {
    partyText.push(
      ...([
        data.from_location && "From: " + data.from_location,
        data.to_location && "To: " + data.to_location,
      ].filter(Boolean) as string[]),
    );
  }
  const left = partyText.flatMap((text, i) =>
    wrap(text, 265, i === 0 ? 11 : 9, i === 0).map((line) => ({
      line,
      size: i === 0 ? 11 : 9,
      strong: i === 0,
    })),
  );
  const right = metadata.flatMap(([label, value]) =>
    wrap(label + ": " + value, 210, 8.5).map((line) => line),
  );
  const height = Math.max(left.length * 14, right.length * 14) + 39;
  if (height < 300) {
    draw(
      !party
        ? "OPERATION DETAILS"
        : purchase || (finance && kind.startsWith("supplier"))
          ? "SUPPLIER"
          : finance
            ? "BILL TO"
            : quote
              ? "CUSTOMER"
              : "SHIP TO",
      40,
      y,
      7.5,
      true,
      muted,
    );
    draw("DOCUMENT DETAILS", 345, y, 7.5, true, muted);
    y -= 21;
    const top = y;
    left.forEach((line, i) =>
      draw(line.line, 40, top - i * 14, line.size, line.strong),
    );
    right.forEach((line, i) => draw(line, 345, top - i * 14, 8.5));
    y = top - Math.max(left.length, right.length) * 14 - 18;
    rule(y);
    y -= 23;
  } else {
    metadata.forEach(([label, value]) => paragraph(label + ": " + value));
    partyText.forEach((line, i) => paragraph(line, i === 0));
  }
  if (!quote && party) {
    const locations = [
      data.from_location && "From: " + data.from_location,
      data.to_location && "To: " + data.to_location,
    ]
      .filter(Boolean)
      .join(" · ");
    if (locations) paragraph(locations);
  }
  if (quote && data.lead_time) paragraph("Lead time: " + data.lead_time);
  y -= 8;
  const widths = summaryOnly
    ? [310, 65, 140]
    : purchase || finance
      ? [180, 55, 40, 110, 130]
      : quote
        ? [180, 55, 40, 85, 65, 90]
        : [210, 140, 90, 75];
  const headers = summaryOnly
    ? ["Description", "Currency", "Amount"]
    : purchase || finance
      ? [
          purchase ? "Material" : "Description",
          "Quantity",
          "Unit",
          "Unit price",
          "Amount",
        ]
      : quote
        ? ["Product", "Quantity", "Unit", "Unit price", "Disc. %", "Amount"]
        : ["Product", "Lot / batch", "Quantity", "Unit"];
  const numericColumns = summaryOnly
    ? [2]
    : purchase || finance
      ? [1, 3, 4]
      : quote
        ? [1, 3, 4, 5]
        : [2];
  function tableHeader() {
    ensure(35);
    page.drawRectangle({
      x: 40,
      y: y - 9,
      width: 515,
      height: 28,
      color: rgb(0.95, 0.97, 0.965),
    });
    let x = 40;
    headers.forEach((h, i) => {
      draw(
        h,
        numericColumns.includes(i)
          ? x + widths[i] - 6 - width(h, 8, true)
          : x + 6,
        y,
        8,
        true,
        muted,
      );
      x += widths[i];
    });
    y -= 10;
    page.drawLine({
      start: { x: 40, y },
      end: { x: 555, y },
      thickness: 0.5,
      color: border,
    });
    y -= 15;
  }
  tableHeader();
  const documentLines = summaryOnly
    ? [
        {
          product:
            data.reason || data.notes || String(row.notes || "") || title,
          amount: String(data.totals?.total || row.amount || ""),
          unit: currency,
        } as ERPLine,
      ]
    : data.lines || [];
  for (const item of documentLines) {
    const identity =
      [item.code, item.product].filter(Boolean).join(" · ") || "—";
    const values = summaryOnly
      ? [item.product || title, currency, decimal(item.amount)]
      : purchase || finance
        ? [
            identity,
            decimal(item.quantity),
            item.unit,
            decimal(item.price),
            decimal(item.amount),
          ]
        : quote
          ? [
              identity,
              decimal(item.quantity),
              item.unit,
              decimal(item.price),
              decimal(item.discount),
              decimal(item.amount),
            ]
          : [
              identity,
              item.lot || "—",
              decimal(item.base_quantity ?? item.quantity),
              item.base_unit || item.unit,
            ];
    const wrapped = values.map((v, i) => wrap(v, widths[i] - 9, 9, i === 0)),
      count = Math.max(...wrapped.map((v) => v.length));
    const rowHeight = count * 13 + 23;
    if (y - rowHeight < 75 && rowHeight < 590) {
      sheet();
      tableHeader();
    }
    for (let j = 0; j < count; j++) {
      if (y < 70) {
        sheet();
        tableHeader();
      }
      let x = 40;
      wrapped.forEach((cell, i) => {
        if (cell[j])
          draw(
            cell[j],
            numericColumns.includes(i)
              ? x + widths[i] - 6 - width(cell[j], 9, i === 0)
              : x + 6,
            y,
            9,
            i === 0,
          );
        x += widths[i];
      });
      y -= 13;
    }
    y -= 9;
    page.drawLine({
      start: { x: 40, y },
      end: { x: 555, y },
      thickness: 0.3,
      color: border,
    });
    y -= 14;
  }
  const totals =
    data.totals || (finance && row.amount ? { total: row.amount } : undefined);
  if (quote && totals) {
    ensure(130);
    y -= 8;
    for (const [key, label] of [
      ["subtotal", "Subtotal"],
      [
        "tax",
        data.tax_rate != null && data.tax_rate !== ""
          ? "Tax (" + data.tax_rate + "%)"
          : "Tax",
      ],
      ["freight", "Freight"],
      ["total", "Total"],
    ] as const) {
      if (
        (purchase ||
          (finance &&
            ["payment_request", "supplier_request"].includes(
              String((row as ERPRow & { kind?: string }).kind),
            ))) &&
        (key === "tax" || key === "freight")
      )
        continue;
      if (totals[key] == null) continue;
      ensure(23);
      if (key === "total") {
        page.drawRectangle({
          x: 321,
          y: y - 9,
          width: 234,
          height: 26,
          color: rgb(0.93, 0.97, 0.95),
        });
      }
      draw(label, 330, y, 10, key === "total");
      const value = `${currency} ${decimal(totals[key])}`;
      draw(
        value,
        555 - width(value, 10, key === "total"),
        y,
        10,
        key === "total",
      );
      y -= 23;
    }
  }
  if (data.terms) {
    y -= 12;
    paragraph("Payment & commercial terms", true);
    paragraph(data.terms);
  }
  if (data.delivery_terms) {
    paragraph("Delivery terms", true);
    paragraph(data.delivery_terms);
  }
  const remarks = data.reason || data.notes || row.notes;
  if (remarks && remarks !== data.terms) {
    paragraph("Reference / remarks", true);
    paragraph(remarks);
  }
  if (data.issuer || data.posted_by) {
    ensure(70);
    y -= 12;
    paragraph("Prepared by: " + (data.issuer || data.posted_by));
  }
  if (!quote && data.kind === "delivery") {
    ensure(85);
    y -= 15;
    paragraph(
      "Received by: ____________________     Date: ____________________",
    );
    paragraph("Signature: ______________________");
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({
      start: { x: 40, y: 42 },
      end: { x: 555, y: 42 },
      thickness: 0.4,
      color: border,
    });
    draw("PT Inovasi Biokem Nusantara", 40, 29, 7, true, muted);
    const footer = wrap(number, 390, 6.5)[0];
    draw(footer, 40, 18, 6.5, false, muted);
    draw(`Page ${i + 1} of ${pages.length}`, 495, 24, 7, false, muted);
  });
  return pdf.save();
}
