import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { decimal, type ERPRow, type ERPLine } from "./schema";
type Snapshot = {
  number: string;
  date: string;
  revision?: number;
  valid_until?: string;
  currency?: string;
  customer?: {
    name?: string;
    billing_address?: string;
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
};
export async function renderERPDocument(
  row: ERPRow,
  type: "quotation" | "movement",
) {
  const quote = type === "quotation",
    draft = quote
      ? ["draft", "pending"].includes(row.state || "")
      : row.state === "draft";
  const data = (
    row.state === "draft" || !row.snapshot
      ? {
          ...row,
          customer: (row as ERPRow & { customer_data?: Snapshot["customer"] })
            .customer_data ?? { name: row.customer },
        }
      : row.snapshot
  ) as Snapshot;
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
  function sheet() {
    page = pdf.addPage([595.28, 841.89]);
    page.drawImage(logo, { x: 40, y: 777, width: 40, height: 40 });
    draw("INBIONUSA", 92, 799, 14, true, brand);
    draw("Commercial & Operations", 92, 781, 8, false, muted);
    draw(
      quote
        ? "QUOTATION"
        : data.kind === "delivery"
          ? "DELIVERY ORDER"
          : "STOCK MOVEMENT",
      330,
      800,
      13,
      true,
      brand,
    );
    draw(String(data.number || row.number), 330, 781, 9, true);
    page.drawLine({
      start: { x: 40, y: 765 },
      end: { x: 555, y: 765 },
      thickness: 1,
      color: border,
    });
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
    y = 744;
  }
  function ensure(height: number) {
    if (y - height < 55) sheet();
  }
  function paragraph(text: string, strong = false, size = 9) {
    for (const line of wrap(text, 515, size, strong)) {
      ensure(15);
      draw(line, 40, y, size, strong);
      y -= 15;
    }
    y -= 5;
  }
  sheet();
  paragraph(
    `${draft ? "DRAFT / NOT ISSUED" : String(row.state || "").toUpperCase()}  ·  ${data.date}${quote ? `  ·  Revision ${data.revision || 1}  ·  Valid until ${data.valid_until}` : ""}`,
    false,
    8,
  );
  if (data.customer) {
    paragraph(data.customer.name || "Customer", true, 12);
    paragraph(
      (quote
        ? data.customer.billing_address
        : data.customer.shipping_address) ||
        data.customer.billing_address ||
        "—",
    );
    if (data.customer.contact) paragraph("Attention: " + data.customer.contact);
    if (data.customer.email || data.customer.phone)
      paragraph(
        [data.customer.email, data.customer.phone].filter(Boolean).join(" · "),
      );
  }
  if (!quote)
    paragraph(
      [
        data.order_number && "Sales order: " + data.order_number,
        data.from_location && "From: " + data.from_location,
        data.to_location && "To: " + data.to_location,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  if (quote && data.lead_time) paragraph("Lead time: " + data.lead_time);
  y -= 8;
  const widths = quote ? [180, 55, 40, 85, 65, 90] : [210, 140, 90, 75];
  const headers = quote
    ? ["Product", "Quantity", "Unit", "Unit price", "Disc. %", "Amount"]
    : ["Product", "Lot / batch", "Quantity", "Unit"];
  function tableHeader() {
    ensure(35);
    let x = 40;
    headers.forEach((h, i) => {
      draw(h, x + 4, y, 8, true, muted);
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
  for (const item of data.lines || []) {
    const values = quote
      ? [
          `${item.code} · ${item.product}`,
          decimal(item.quantity),
          item.unit,
          decimal(item.price),
          decimal(item.discount),
          decimal(item.amount),
        ]
      : [
          `${item.code || ""} · ${item.product}`,
          item.lot || "—",
          decimal(item.base_quantity ?? item.quantity),
          item.base_unit || item.unit,
        ];
    const wrapped = values.map((v, i) => wrap(v, widths[i] - 9, 9, i === 0)),
      count = Math.max(...wrapped.map((v) => v.length));
    for (let j = 0; j < count; j++) {
      if (y < 70) {
        sheet();
        tableHeader();
      }
      let x = 40;
      wrapped.forEach((cell, i) => {
        if (cell[j]) draw(cell[j], x + 4, y, 9, i === 0);
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
  if (quote && data.totals) {
    y -= 8;
    for (const [key, label] of [
      ["subtotal", "Subtotal"],
      ["tax", "Tax (" + (data.tax_rate || "0") + "%)"],
      ["freight", "Freight"],
      ["total", "Total"],
    ] as const) {
      ensure(23);
      draw(label, 330, y, 10, key === "total");
      const value = `${data.currency} ${decimal(data.totals[key])}`;
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
  if (data.reason) {
    paragraph("Reference / remarks", true);
    paragraph(data.reason);
  }
  if (data.issuer || data.posted_by) {
    y -= 12;
    paragraph("Prepared by: " + (data.issuer || data.posted_by));
  }
  if (!quote && data.kind === "delivery") {
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
    draw("INBIONUSA · " + data.number, 40, 28, 7, false, muted);
    draw(`${i + 1} / ${pages.length}`, 520, 28, 7, false, muted);
  });
  return pdf.save();
}
