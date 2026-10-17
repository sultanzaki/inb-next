import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { COA, HasilUjiItem } from "@/lib/types";
import { businessDate } from "@/lib/domain/validation";
export type CoaDocument = Pick<
  COA,
  | "no_coa"
  | "no_lot"
  | "tanggal_rilis"
  | "tanggal_expired"
  | "hasil_uji_snapshot"
  | "tanda_tangan_digital"
  | "mfg_date"
  | "language"
  | "inci_name"
  | "compliance_statement"
  | "delivery_date"
>;
type Style = "regular" | "bold" | "italic";
type Fonts = Record<
  Style,
  { primary: PDFFont; fallback: PDFFont; characters: Set<number> }
>;
type Row = { cells: string[][]; height: number };
type Note = { text: string; style: Style; size: number; y: number };
type Sheet = { rows: Row[]; notes: Note[] };
const asset = (name: string) =>
  readFile(path.join(process.cwd(), "src/assets/coa", name));
const date = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10).split("-").reverse().join("-")
    : "-";
function runs(text: string, font: Fonts[Style]) {
  const list: { font: PDFFont; text: string }[] = [];
  for (const ch of text.replace(/[\r\n\t]/g, " ")) {
    const selected = font.characters.has(ch.codePointAt(0)!)
      ? font.primary
      : font.fallback;
    const last = list.at(-1);
    if (last?.font === selected) last.text += ch;
    else list.push({ font: selected, text: ch });
  }
  return list;
}
function width(text: string, font: Fonts[Style], size: number) {
  return runs(text, font).reduce(
    (sum, r) => sum + r.font.widthOfTextAtSize(r.text, size),
    0,
  );
}
function wrap(text: string, font: Fonts[Style], size: number, max: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const trial = line ? line + " " + word : word;
      if (width(trial, font, size) <= max) {
        line = trial;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      let part = "";
      for (const ch of word) {
        if (part && width(part + ch, font, size) > max) {
          lines.push(part);
          part = "";
        }
        part += ch;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}
function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: Fonts[Style],
  size: number,
  center = false,
) {
  let start = center ? x - width(text, font, size) / 2 : x;
  for (const run of runs(text, font)) {
    page.drawText(run.text, {
      x: start,
      y: page.getHeight() - y,
      font: run.font,
      size,
      color: rgb(0, 0, 0),
    });
    start += run.font.widthOfTextAtSize(run.text, size);
  }
}
function rule(page: PDFPage, y: number, thickness = 0.4) {
  page.drawLine({
    start: { x: 56.7, y: page.getHeight() - y },
    end: { x: 524.15, y: page.getHeight() - y },
    thickness,
    color: rgb(0, 0, 0),
  });
}
function specification(item: HasilUjiItem, language: "id" | "en") {
  if (item.t === "TEXT")
    return language === "en"
      ? item.k_en || item.k || (language === "en" ? "Observation" : "Observasi")
      : item.k || "Observasi";
  if (item.t === "MIN") return "≥ " + item.mn;
  if (item.t === "MAX") return "≤ " + item.mx;
  return item.mn + " – " + item.mx;
}
export async function renderCoaPdf(
  coa: CoaDocument,
  {
    preview = false,
    printDate = businessDate(),
  }: { preview?: boolean; printDate?: string } = {},
) {
  const language = coa.language || "en",
    id = language === "id";
  const labels = id
    ? {
        title: "Sertifikat Analisis",
        inci: "Nama INCI",
        certificate: "Sertifikat",
        batch: "Nomor batch",
        mfg: "Tgl. produksi",
        expiry: "Tgl. kedaluwarsa",
        print: "Tgl. cetak",
        page: "Halaman",
        test: "Pengujian",
        spec: "Spesifikasi",
        result: "Hasil uji",
        delivery: "Tanggal pengiriman",
        approved: "Disetujui oleh,",
        quality: "Pengendalian Mutu",
        disclaimer:
          "Keterangan di atas tidak membebaskan pelanggan dari kewajiban melakukan pemeriksaan atas barang yang diterima.",
        signature: "Laporan ini tidak memerlukan tanda tangan.",
      }
    : {
        title: "Certificate of Analysis",
        inci: "INCI Name",
        certificate: "Certificate",
        batch: "Batch number",
        mfg: "Mfg. Date",
        expiry: "Exp. Date",
        print: "Print Date",
        page: "Page / Pages",
        test: "Test",
        spec: "Specification",
        result: "Test results",
        delivery: "Delivery Date",
        approved: "Approved by,",
        quality: "Quality Control",
        disclaimer:
          "The above particulars do not release the customer from the obligation to carry out an inspection of goods received.",
        signature: "This report does not require signature",
      };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {} as Fonts;
  for (const [style, suffix] of [
    ["regular", ""],
    ["bold", "-Bold"],
    ["italic", "-Italic"],
  ] as const) {
    const primary = await doc.embedFont(
      await asset("Aptos" + suffix + ".ttf"),
      { subset: true },
    );
    const fallback = await doc.embedFont(
      await asset("Fallback" + suffix + ".ttf"),
      { subset: true },
    );
    fonts[style] = {
      primary,
      fallback,
      characters: new Set(primary.getCharacterSet()),
    };
  }
  const template = await PDFDocument.load(await asset("letterhead.pdf"));
  const items = coa.hasil_uji_snapshot.items || [];
  if (items.length > 200)
    throw Error("Terlalu banyak parameter untuk sertifikat.");
  const rows: Row[] = items.map((item) => {
    const parameter =
      (id ? item.p : item.p_en || item.p) + (item.u ? ", " + item.u : "");
    const cells = [
      wrap(parameter, fonts.regular, 12, 284),
      wrap(specification(item, language), fonts.regular, 12, 80),
      wrap(
        (language === "en" && item.t === "TEXT"
          ? item.val_en || item.val
          : item.val) || "-",
        fonts.regular,
        12,
        80,
      ),
    ];
    return {
      cells,
      height: Math.max(
        15.12,
        Math.max(...cells.map((c) => c.length)) * 13.5 + 1.62,
      ),
    };
  });
  const sheets: Sheet[] = [];
  let sheet: Sheet = { rows: [], notes: [] },
    used = 0;
  for (const row of rows) {
    if (row.height > 226.8)
      throw Error(
        "Satu parameter terlalu panjang. Ringkas label atau hasil pengujiannya.",
      );
    if (sheet.rows.length >= 15 || used + row.height > 226.9) {
      sheets.push(sheet);
      sheet = { rows: [], notes: [] };
      used = 0;
    }
    sheet.rows.push(row);
    used += row.height;
  }
  sheets.push(sheet);
  const noteBlocks: {
    text: string;
    style: Style;
    size: number;
    gap: number;
  }[] = [];
  if (coa.compliance_statement?.trim())
    noteBlocks.push({
      text: coa.compliance_statement.trim(),
      style: "italic",
      size: 12,
      gap: 12,
    });
  noteBlocks.push(
    {
      text: labels.delivery + " : " + date(coa.delivery_date),
      style: "bold",
      size: 12,
      gap: 16,
    },
    { text: labels.approved, style: "bold", size: 12, gap: 30 },
    { text: labels.quality, style: "bold", size: 12, gap: 16 },
    { text: labels.disclaimer, style: "regular", size: 11.04, gap: 18 },
    { text: labels.signature, style: "italic", size: 11.04, gap: 16 },
  );
  let last = sheets.at(-1)!,
    y =
      (sheets.length === 1 ? 354.54 : 298.02) +
      last.rows.reduce((n, r) => n + r.height, 0) +
      12;
  for (const block of noteBlocks) {
    y += block.gap;
    for (const line of wrap(block.text, fonts[block.style], block.size, 468)) {
      if (y > 770) {
        last = { rows: [], notes: [] };
        sheets.push(last);
        y = 294;
      }
      last.notes.push({ text: line, style: block.style, size: block.size, y });
      y += block.size * 1.22;
    }
  }
  for (let index = 0; index < sheets.length; index++) {
    const content = sheets[index],
      first = index === 0,
      [page] = await doc.copyPages(template, [first ? 0 : 1]);
    doc.addPage(page);
    if (first) draw(page, labels.title, 297.66, 151.6, fonts.bold, 18, true);
    const product =
      (language === "en"
        ? coa.hasil_uji_snapshot.produk_en || coa.hasil_uji_snapshot.produk
        : coa.hasil_uji_snapshot.produk) || "-";
    if (width(product, fonts.bold, 8) > 468)
      throw Error("Nama produk terlalu panjang untuk template.");
    const productSize = Math.max(
      8,
      Math.min(12, (12 * 468) / Math.max(1, width(product, fonts.bold, 12))),
    );
    const titleY = first ? 194.04 : 140.4;
    rule(page, first ? 176.93 : 123.62, 1.5);
    draw(page, product, 56.64, titleY, fonts.bold, productSize);
    const inci =
      labels.inci +
      ": " +
      (coa.inci_name || coa.hasil_uji_snapshot.inci_name || "-");
    if (width(inci, fonts.italic, 8) > 468)
      throw Error("Nama INCI terlalu panjang untuk template.");
    draw(
      page,
      inci,
      56.64,
      titleY + 14.7,
      fonts.italic,
      Math.max(
        8,
        Math.min(12, (12 * 468) / Math.max(1, width(inci, fonts.italic, 12))),
      ),
    );
    const meta = [
      [
        labels.certificate,
        coa.no_coa ||
          (id ? "Nomor otomatis saat diterbitkan" : "Assigned on issue"),
      ],
      [labels.batch, coa.no_lot],
      [labels.mfg, date(coa.mfg_date)],
      [labels.expiry, date(coa.tanggal_expired)],
      [labels.print, date(printDate)],
      [labels.page, `${index + 1}/${sheets.length}`],
    ];
    let metaY = first ? 238.08 : 180.72;
    for (const [label, value] of meta) {
      draw(page, label, 56.64, metaY, fonts.regular, 12);
      const text = ": " + value;
      if (width(text, fonts.regular, 8) > 365)
        throw Error("Identitas sertifikat terlalu panjang untuk template.");
      draw(
        page,
        text,
        158.66,
        metaY,
        fonts.regular,
        Math.max(
          8,
          Math.min(
            12,
            (12 * 365) / Math.max(1, width(text, fonts.regular, 12)),
          ),
        ),
      );
      metaY += 14.64;
    }
    rule(page, first ? 321.11 : 264.14, 1.5);
    if (content.rows.length) {
      let top = first ? 339.3 : 282.78;
      rule(page, top);
      draw(page, labels.test, 62.06, top + 10.4, fonts.bold, 12);
      draw(page, labels.spec, 398.18, top + 10.4, fonts.bold, 12, true);
      draw(page, labels.result, 483.17, top + 10.4, fonts.bold, 12, true);
      top += 15.12;
      rule(page, top);
      for (const row of content.rows) {
        for (let col = 0; col < 3; col++) {
          row.cells[col].forEach((line, lineIndex) =>
            draw(
              page,
              line,
              col === 0 ? 62.06 : col === 1 ? 398.18 : 483.17,
              top + 10.4 + lineIndex * 13.5,
              fonts.regular,
              12,
              col !== 0,
            ),
          );
        }
        top += row.height;
        rule(page, top);
      }
    }
    for (const note of content.notes)
      draw(page, note.text, 56.64, note.y, fonts[note.style], note.size);
    if (preview) {
      page.drawText(
        id ? "PRATINJAU — BELUM DITERBITKAN" : "PREVIEW — NOT ISSUED",
        {
          x: 56.64,
          y: page.getHeight() - 34,
          size: 9,
          font: fonts.regular.fallback,
          color: rgb(185 / 255, 28 / 255, 28 / 255),
        },
      );
    }
  }
  doc.setTitle(coa.no_coa || "COA preview");
  doc.setAuthor("PT INOVASI BIOKEM NUSANTARA");
  doc.setSubject("Certificate of Analysis");
  doc.setCreator("INBIONUSA QC · inb-reference-v1");
  return doc.save();
}
