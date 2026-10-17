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
