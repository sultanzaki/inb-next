import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  actionSchemas,
  decimal,
  type ERPRow,
  type ERPLine,
} from "../src/lib/erp/schema";
import { renderERPDocument } from "../src/lib/erp/pdf";
const id = "11111111-1111-4111-8111-111111111111";
test("ERP quantities normalize decimal commas and reject ambiguous/invalid input", () => {
  assert.equal(
    actionSchemas.count_line.parse({ id, lot_id: id, quantity: "0,125" })
      .quantity,
    "0.125",
  );
  for (const quantity of [
    "-1",
    "NaN",
    "Infinity",
    "1e6",
    "1.2.3",
    "1,000,000",
    "0x10",
    "1.0000001",
  ])
    assert.equal(
      actionSchemas.count_line.safeParse({ id, lot_id: id, quantity }).success,
      false,
      quantity,
    );
  assert.equal(
    actionSchemas.set_access.safeParse({
      user_id: id,
      module: "warehouse",
      read: false,
      write: true,
      approve: false,
    }).success,
    false,
  );
});
test("ERP display keeps large decimal strings exact", () => {
  assert.equal(decimal("123456789012.123456"), "123,456,789,012.123456");
  assert.equal(decimal("0.300000"), "0.3");
  assert.equal(decimal("-123.050000"), "-123.05");
  assert.equal(decimal(null), "—");
});
test("ERP server PDF retains every line, immutable customer details and draft labels", async () => {
  const lines: ERPLine[] = Array.from({ length: 60 }, (_, i) => ({
    product_id: id,
    code: "SKU-" + i,
    product:
      "Unique item " +
      i +
      " " +
      "Calcium stearate extended description ".repeat(6),
    unit_id: id,
    unit: "bag",
    quantity: "4",
    base_unit: "kg",
    base_quantity: "100",
    factor: "25",
    price: "1000",
    discount: "5",
    amount: "3800",
  }));
  const snapshot = {
    number: "QUO-TEST",
    revision: 2,
    date: "2026-10-17",
    valid_until: "2026-11-17",
    currency: "IDR",
    customer: {
      name: "Original legal customer",
      billing_address: "Original frozen address",
    },
    lines,
    terms: "Frozen terms",
    tax_rate: "11",
    totals: { subtotal: "228000", tax: "25080", freight: "0", total: "253080" },
  };
  const row: ERPRow = {
    id,
    number: "Changed number",
    state: "issued",
    customer: "Changed customer",
    lines: [],
    snapshot,
  };
  const bytes = await renderERPDocument(row, "quotation");
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 2);
  const folder = await mkdtemp(join(tmpdir(), "inb-erp-pdf-"));
  try {
    const file = join(folder, "quote.pdf");
    await writeFile(file, bytes);
    const text = execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
    });
    for (let i = 0; i < 60; i++) assert.ok(text.includes("Unique item " + i));
    assert.ok(text.includes("Original frozen address"));
    assert.ok(!text.includes("Changed customer"));
    assert.ok(!text.includes("Changed number"));
    const draft = await renderERPDocument(
      {
        ...row,
        state: "draft",
        number: "DRAFT-1",
        date: "2026-10-17",
        lines: lines.slice(0, 1),
        customer_data: { name: "Draft customer" },
      } as ERPRow,
      "quotation",
    );
    await writeFile(file, draft);
    assert.match(
      execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }),
      /DRAFT/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("ERP origin checks accept reverse-proxied same-origin requests and reject cross-site origins", async () => {
  const { sameOrigin } = await import("../src/lib/erp/origin");
  assert.equal(
    sameOrigin("http://127.0.0.1:3004", "127.0.0.1:3004", "http"),
    true,
  );
  assert.equal(
    sameOrigin("https://inb-next.vercel.app", "inb-next.vercel.app", "https"),
    true,
  );
  assert.equal(
    sameOrigin("https://evil.example", "inb-next.vercel.app", "https"),
    false,
  );
  assert.equal(sameOrigin("null", "inb-next.vercel.app", "https"), false);
  assert.equal(
    sameOrigin("http://inb-next.vercel.app", "inb-next.vercel.app", "https"),
    false,
  );
});

test("purchase PDF names the supplier and preserves exact server line amounts", async () => {
  const folder = await mkdtemp(join(tmpdir(), "inb-purchase-pdf-"));
  try {
    const bytes = await renderERPDocument(
      {
        id,
        number: "PO-TEST",
        date: "2026-10-18",
        valid_until: "2026-10-20",
        state: "confirmed",
        notes: "Deliver in sealed bags.",
        currency: "IDR",
        customer_data: {
          name: "Original supplier",
          billing_address: "Supplier address",
        },
        lines: [
          {
            product_id: id,
            product: "Stearic acid",
            code: "RM-01",
            unit_id: id,
            unit: "kg",
            quantity: "0.3",
            base_quantity: "0.3",
            base_unit: "kg",
            factor: "1",
            price: "12500.25",
            amount: "3750.075",
          },
        ],
        totals: { subtotal: "3750.075", total: "3750.075" },
      },
      "purchase",
    );
    const file = join(folder, "purchase.pdf");
    await writeFile(file, bytes);
    const contents = execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
    });
    assert.match(contents, /PURCHASE ORDER/);
    assert.match(contents, /Original supplier/);
    assert.match(contents, /Deliver in sealed bags\./);
    assert.match(contents, /3,750.075/);
    assert.match(contents, /Expected receipt: 2026-10-20/);
    assert.doesNotMatch(contents, /Valid until|Disc\. %/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test("growth document links reject unsafe schemes and embedded credentials", () => {
  const payload = {
    product_id: id,
    kind: "SDS",
    language: "en",
    title: "SDS",
    file_url: "https://example.com/sds.pdf",
    effective_date: "2026-10-18",
    expiry_date: "",
    notes: "",
  };
  assert.equal(
    actionSchemas.save_product_document.safeParse(payload).success,
    true,
  );
  for (const url of [
    "",
    "not a URL",
    "https://",
    "javascript:alert(1)",
    "http://example.com/sds",
    "https://user:password@example.com/sds",
  ]) {
    assert.equal(
      actionSchemas.save_product_document.safeParse({
        ...payload,
        file_url: url,
      }).success,
      false,
    );
  }
});

test("formal Finance PDF uses the document due date, frozen party and exact amounts without empty product rows", async () => {
  const folder = await mkdtemp(join(tmpdir(), "inb-formal-finance-"));
  try {
    const bytes = await renderERPDocument(
      {
        id,
        number: "INV-FORMAL-001",
        kind: "invoice",
        state: "issued",
        date: "2026-10-21",
        due_date: "2026-11-20",
        amount: "60000000",
        notes: "Payment for the agreed supply.",
        snapshot: {
          number: "INV-FORMAL-001",
          date: "2026-10-21",
          currency: "IDR",
          customer: {
            name: "Frozen customer",
            billing_address: "Original billing address",
          },
          order_number: "SO-ORIGINAL",
          lines: [],
          totals: {
            subtotal: "54054054.054054",
            tax: "5945945.945946",
            freight: "0",
            total: "60000000",
          },
        },
        customer: "Renamed customer",
        lines: [],
      } as Parameters<typeof renderERPDocument>[0],
      "finance",
    );
    const file = join(folder, "invoice.pdf");
    await writeFile(file, bytes);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getTitle(), "INVOICE · INV-FORMAL-001");
    assert.equal(doc.getAuthor(), "PT Inovasi Biokem Nusantara");
    const contents = execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
    });
    assert.match(contents, /Due date: 2026-11-20/);
    assert.match(contents, /Frozen customer/);
    assert.match(contents, /Original billing address/);
    assert.match(contents, /SO-ORIGINAL/);
    assert.match(contents, /60,000,000/);
    assert.match(contents, /Page 1 of 1/);
    assert.doesNotMatch(contents, /Renamed customer|undefined|NaN|Tax \(0%\)/);
    const bounds = execFileSync("pdftotext", ["-bbox", file, "-"], {
      encoding: "utf8",
    });
    for (const match of bounds.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
    )) {
      assert.ok(
        Number(match[1]) >= 39 && Number(match[3]) <= 556,
        "Text stays within the print margins",
      );
      assert.ok(Number(match[2]) >= 10 && Number(match[4]) <= 832);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("draft movement PDF uses location names rather than internal IDs", async () => {
  const folder = await mkdtemp(join(tmpdir(), "inb-draft-movement-"));
  try {
    const bytes = await renderERPDocument(
      {
        id,
        number: "MOVE-DRAFT",
        kind: "transfer",
        state: "draft",
        date: "2026-10-21",
        from_location: id,
        to_location: id,
        source: "Main warehouse",
        destination: "Dispatch area",
        lines: [],
      } as Parameters<typeof renderERPDocument>[0],
      "movement",
    );
    const file = join(folder, "draft.pdf");
    await writeFile(file, bytes);
    const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
    assert.match(text, /Main warehouse/);
    assert.match(text, /Dispatch area/);
    assert.match(text, /OPERATION DETAILS/);
    assert.doesNotMatch(text, new RegExp(id));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
