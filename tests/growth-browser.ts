import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseGrowth(
  page: Page,
  db: Client,
  origin: string,
  suffix: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const top = () => page.getByRole("dialog").last();
  async function pick(label: string, q: string) {
    await page.getByRole("button", { name: label, exact: true }).last().click();
    await page
      .getByRole("textbox", { name: "Search " + label, exact: true })
      .fill(q);
    await page
      .locator(".erp-picker-results button")
      .filter({ hasText: q })
      .first()
      .click();
  }
  async function save(name: string) {
    await top().getByRole("button", { name, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  }
  async function action(name: string) {
    await page.getByRole("button", { name, exact: true }).click();
    await top().getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  }
  async function post(name: string, data: unknown) {
    const r = await page.request.post(origin + "/api/erp/" + name, {
      data,
      headers: { origin },
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  }
  async function read(entity: string, id?: string) {
    const r = await page.request.get(
      origin + "/api/erp/" + entity + (id ? "?id=" + id : ""),
    );
    assert.equal(r.status(), 200);
    return r.json();
  }
  const today = (await db.query("select erp_today()::text d")).rows[0].d;
  const supplier = "Supplier " + suffix,
    material = "Stearic acid " + suffix,
    company = "Prospect " + suffix,
    title = "SDS " + suffix;
  const productName = "Growth stearate " + suffix;
  const product = (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,$2,'Chemical','kg','Halal','Bag') returning id",
      ["GROWTH-" + suffix, productName],
    )
  ).rows[0].id;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/purchase?view=suppliers");
  await page.getByRole("button", { name: "New supplier", exact: true }).click();
  await top().getByLabel("Supplier name", { exact: true }).fill(supplier);
  await save("Save supplier");
  await page.goto(origin + "/dashboard/purchase?view=materials");
  await page.getByRole("button", { name: "New material", exact: true }).click();
  await top()
    .getByLabel("Material code", { exact: true })
    .fill("RM-" + suffix);
  await top().getByLabel("Material name", { exact: true }).fill(material);
  await pick("Base unit", "kg");
  await top().getByLabel("Minimum stock", { exact: true }).fill("50");
  await save("Save material");
  await page.goto(origin + "/dashboard/purchase?view=purchases");
  await page
    .getByRole("button", { name: "New purchase order", exact: true })
    .click();
  await pick("Supplier", supplier);
  await pick("Material", material);
  await top()
    .getByLabel(/Quantity \(/)
    .fill("100");
  await top().getByLabel("Unit price", { exact: true }).fill("12500.25");
  await capture("70-purchase-form");
  await accessible();
  await save("Save draft");
  const po = (
    await db.query(
      "select p.* from erp_purchase_orders p join erp_suppliers s on s.id=p.supplier_id where s.name=$1",
      [supplier],
    )
  ).rows[0];
  await page.getByRole("button", { name: po.number, exact: true }).click();
  await action("Confirm purchase");
  await page.getByRole("button", { name: po.number, exact: true }).click();
  const pdf = await page.request.get(
    origin + "/api/erp/documents/purchases/" + po.id,
  );
  assert.equal(pdf.status(), 200);
  assert.match(pdf.headers()["content-type"], /application\/pdf/);
  assert.ok((await pdf.body()).length > 1000);
  await page
    .getByRole("button", { name: "Receive materials", exact: true })
    .click();
  await pick("Receive into", "MAIN");
  await top().getByLabel("Receive quantity", { exact: true }).fill("25");
  await top()
    .getByLabel("Supplier lot number", { exact: true })
    .fill("SUP-" + suffix);
  await capture("71-purchase-receipt");
  await accessible();
  await save("Post receipt");
  assert.equal((await read("purchases", po.id)).rows[0].state, "partial");
  await page.goto(origin + "/dashboard/materials");
  await page
    .getByRole("button", { name: "RM-" + suffix, exact: true })
    .waitFor();
  await capture("72-material-stock");
  await accessible();
  const stock = (await read("material_stock")).rows.find(
    (r: { lot_number: string }) => r.lot_number === "SUP-" + suffix,
  );
  assert.equal(stock.quantity, "25.000000");
  await page.goto(origin + "/dashboard/crm");
  await page
    .getByRole("button", { name: "New opportunity", exact: true })
    .click();
  await top()
    .getByLabel("Opportunity title", { exact: true })
    .fill("Stearate supply " + suffix);
  await top().getByLabel("Company", { exact: true }).fill(company);
  await top().getByLabel("Expected value", { exact: true }).fill("15000000");
  await save("Save opportunity");
  const opp = (
    await db.query("select * from erp_opportunities where company=$1", [
      company,
    ])
  ).rows[0];
  await page.getByRole("button", { name: opp.number, exact: true }).click();
  await page
    .getByRole("button", { name: "Schedule activity", exact: true })
    .click();
  await top()
    .getByLabel("Activity title", { exact: true })
    .fill("Follow up sample " + suffix);
  await save("Schedule activity");
  await page.getByRole("button", { name: opp.number, exact: true }).click();
  await page
    .getByRole("button", { name: "Link customer", exact: true })
    .click();
  await save("Link customer");
  await page.getByRole("button", { name: opp.number, exact: true }).click();
  await capture("73-crm-opportunity");
  await accessible();
  await page
    .getByRole("link", { name: "Create quotation", exact: false })
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByText("Linked to the originating CRM opportunity.", { exact: false })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  await page.goto(origin + "/dashboard/documents");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await pick("Product", productName);
  await top().getByLabel("Title", { exact: true }).fill(title);
  await top()
    .getByLabel("Document link (HTTPS)", { exact: true })
    .fill("https://example.com/sds.pdf");
  await capture("74-product-document-form");
  await accessible();
  await save("Save draft");
  const doc = (
    await db.query("select * from erp_product_documents where title=$1", [
      title,
    ])
  ).rows[0];
  await page.getByRole("button", { name: doc.number, exact: true }).click();
  await action("Publish revision");
  assert.equal(
    (await read("product_documents", doc.id)).rows[0].state,
    "published",
  );
  const productScoped = await page.request.get(
    origin + "/api/erp/product_documents?id=product:" + doc.product_id,
  );
  assert.equal(productScoped.status(), 200);
  assert.ok(
    (await productScoped.json()).rows.every(
      (r: { product_id: string }) => r.product_id === doc.product_id,
    ),
  );
  await page.goto(origin + "/dashboard/documents?product=" + doc.product_id);
  await page.getByRole("button", { name: "New document", exact: true }).click();
  assert.match(
    await top()
      .getByRole("button", { name: "Product", exact: true })
      .innerText(),
    /Selected product/,
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  await page.setViewportSize({ width: 375, height: 860 });
  await page.goto(origin + "/dashboard/purchase?view=purchases");
  await page
    .getByRole("combobox", { name: "Filter status", exact: true })
    .selectOption("partial");
  await page.getByRole("button", { name: "Choose page", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Workspace pages", exact: true })
    .getByRole("link", { name: "Suppliers", exact: true })
    .click();
  await page.getByRole("heading", { name: "Suppliers", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Filter status", exact: true })
      .inputValue(),
    "",
  );
  await page.getByRole("button", { name: supplier, exact: true }).waitFor();
  // Exercise every new view and editor at narrow widths, including the contextual menu.
  for (const width of [375, 320, 430]) {
    await page.setViewportSize({ width, height: 860 });
    for (const [route, name] of [
      ["purchase?view=purchases", "New purchase order"],
      ["crm?view=opportunities", "New opportunity"],
      ["documents", "New document"],
      ["materials", "Issue material"],
    ]) {
      await page.goto(origin + "/dashboard/" + route);
      await page.getByRole("button", { name, exact: true }).waitFor();
      await page.locator(".growth-record-link").first().waitFor();
      await capture(`75-${route.split("?")[0]}-${width}`);
      await accessible();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.getByRole("button", { name, exact: true }).click();
      await top().waitFor();
      await accessible();
      assert.ok(
        await top().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "mobile modal does not overflow",
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
    }
  }
  const filtered = await page.request.get(
    origin +
      "/api/erp/export/purchases?q=" +
      encodeURIComponent(po.number) +
      "&state=partial",
  );
  assert.equal(filtered.status(), 200);
  assert.match(await filtered.text(), new RegExp(po.number));
  for (const context of ["purchase", "crm", "documents"]) {
    const r = await page.request.get(
      origin + "/api/erp/overview?state=" + context + "&q=7",
    );
    assert.equal(r.status(), 200);
    assert.equal((await r.json()).series.length, 7);
  }
  const token = (await page.context().cookies()).find(
    (c) => c.name === "session_token",
  )!.value;
  // The created customer is immediately usable by Sales and retains its CRM source.
  const linked = (await read("opportunities", opp.id)).rows[0];
  const kg = (await db.query("select id from erp_units where code='kg'"))
    .rows[0].id;
  await post("save_conversion", {
    product_id: product,
    unit_id: kg,
    factor: "1",
    is_base: true,
  });
  const quote = await post("save_quote", {
    customer_id: linked.customer_id,
    opportunity_id: opp.id,
    date: today,
    valid_until: today,
    currency: "IDR",
    terms: "",
    delivery_terms: "",
    lead_time: "",
    tax_rate: "0",
    freight: "0",
    lines: [
      {
        product_id: product,
        unit_id: kg,
        quantity: "10",
        price: "1000",
        discount: "0",
      },
    ],
  });
  assert.equal((await read("quotes", quote.id)).rows[0].opportunity_id, opp.id);
  assert.ok(
    (
      await db.query(
        "select count(*) n from audit_log where aksi='insert_erp_purchase_orders' and referensi=$1",
        [po.id],
      )
    ).rows[0].n > 0,
  );
  assert.ok(token);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
