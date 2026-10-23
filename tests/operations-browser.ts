import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
import { PDFDocument } from "pdf-lib";
export async function exerciseOperations(
  page: Page,
  db: Client,
  origin: string,
  user: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  await db.query("update erp_modules set state='active'");
  assert.equal((await fetch(origin + "/api/operations/pallets")).status, 401);
  assert.equal(
    (await fetch(origin + "/api/operations-document/batch/" + randomUUID()))
      .status,
    401,
  );
  async function command(name: string, data: Record<string, unknown>) {
    const response = await page.request.post(
      origin + "/api/operations/" + name,
      { data: { request_key: randomUUID(), ...data }, headers: { origin } },
    );
    const result = await response.json();
    assert.equal(response.status(), 200, `${name}: ${JSON.stringify(result)}`);
    return result;
  }
  const wh = await command("save_warehouse", {
    code: "BW-" + randomUUID().slice(0, 8),
    name: "Browser warehouse " + randomUUID().slice(0, 8),
    address: "",
    active: true,
  });
  const locationName = "Browser source " + randomUUID().slice(0, 8);
  const location = await command("save_warehouse_location", {
    code: "BL-" + randomUUID().slice(0, 8),
    name: locationName,
    warehouse_id: wh.id,
    bin: "A1",
    active: true,
  });
  const material = (
    await db.query(
      "insert into erp_materials(code,name,unit_id) select $1,'Browser stearic acid',id from erp_units limit 1 returning id",
      ["BM-" + randomUUID().slice(0, 8)],
    )
  ).rows[0];
  const supplier = (
    await db.query(
      "insert into erp_suppliers(name) values('Browser supplier') returning id",
    )
  ).rows[0];
  const lot = (
    await db.query(
      "insert into erp_material_lots(material_id,supplier_id,number,expiry_date) values($1,$2,$3,erp_today()+365) returning id",
      [material.id, supplier.id, "BROWSER-MAT-" + randomUUID().slice(0, 8)],
    )
  ).rows[0];
  await db.query("insert into erp_material_balances values($1,$2,100)", [
    lot.id,
    location.id,
  ]);
  await page.goto(origin + "/dashboard/warehouse/pallets");
  await page
    .getByRole("heading", { name: "Pallet tracking", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "New pallet", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Pallet location", exact: true })
    .click();
  const picker = page.locator(".work-picker");
  await picker.getByPlaceholder("Search pallet location…").fill(locationName);
  await picker.getByRole("option").first().click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".work-detail-identity").waitFor();
  const recordId = new URL(page.url()).searchParams.get("record");
  assert.ok(recordId);
  const label = await page.request.get(
    origin + "/api/operations-label/" + recordId,
  );
  assert.equal(label.status(), 200);
  assert.match(await label.text(), /<svg/);
  const palletRecord = await (
    await page.request.get(origin + "/api/operations/pallets?id=" + recordId)
  ).json();
  const palletNumber = encodeURIComponent(palletRecord.rows[0].number);
  const exported = await page.request.get(
    origin + "/api/operations/pallets?q=" + palletNumber + "&export=csv",
  );
  assert.equal(exported.status(), 200);
  assert.equal(
    (await exported.text()).trim().split(/\r?\n/).length,
    2,
    "filtered CSV exports exactly the selected pallet",
  );
  const excel = await page.request.get(
    origin +
      "/api/operations/pallets?q=" +
      palletNumber +
      "&export=csv&format=xlsx",
  );
  assert.equal(excel.status(), 200);
  assert.equal(
    (await excel.body()).subarray(0, 2).toString(),
    "PK",
    "Excel requests return an XLSX archive",
  );

  const crossOrigin = await page.request.post(
    origin + "/api/operations/create_pallet",
    {
      headers: { origin: "https://untrusted.example" },
      data: { request_key: randomUUID(), location_id: location.id },
    },
  );
  assert.equal(crossOrigin.status(), 403);
  const spec = await command("save_material_spec", {
    material_id: material.id,
    title: "Browser incoming specification",
    effective_date: new Date().toISOString().slice(0, 10),
    parameters: [
      {
        name: "Purity",
        kind: "range",
        minimum: "98",
        maximum: "100",
        unit: "%",
      },
    ],
  });
  await command("approve_material_spec", {
    id: spec.id,
    version: 1,
    reason: "Browser specification approved",
  });
  const inspection = await command("create_incoming_inspection", {
    lot_id: lot.id,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    origin + "/dashboard/quality/incoming-inspections?record=" + inspection.id,
  );
  await page.locator(".work-detail-identity").waitFor();
  await page
    .getByRole("button", { name: "Enter inspection results", exact: true })
    .click();
  await dialog.getByLabel("Purity", { exact: false }).fill("99.5");
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    true,
    "mobile form does not overflow",
  );
  const geometry = await dialog.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    height: el.getBoundingClientRect().height,
    scroll: el.scrollTop,
    header: el
      .querySelector("[data-slot=dialog-header]")
      ?.getBoundingClientRect().top,
    style: {
      top: getComputedStyle(el).top,
      translate: getComputedStyle(el).translate,
      transform: getComputedStyle(el).transform,
    },
  }));
  assert.ok(
    Number(geometry.header) >= 0,
    "mobile form heading stays inside the viewport",
  );
  await capture("operations-incoming-mobile");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".work-detail-identity").waitFor();
  const pdf = await page.request.get(
    origin +
      "/api/operations-document/incoming/" +
      inspection.id +
      "?download=1",
  );
  assert.equal(pdf.status(), 200);
  assert.match(pdf.headers()["content-type"], /application\/pdf/);
  assert.match(pdf.headers()["cache-control"], /no-store/);
  const pdfDocument = await PDFDocument.load(await pdf.body());
  assert.match(pdfDocument.getTitle() || "", /INCOMING/);
  for (const route of [
    "production/formulas",
    "production/orders",
    "quality/material-specifications",
    "quality/deviations",
    "quality/capa",
    "warehouse/transfers",
    "warehouse/material-inventory",
    "crm/samples",
    "crm/interactions",
    "crm/documents",
    "product-documents/materials",
  ]) {
    await page.goto(origin + "/dashboard/" + route);
    await page
      .locator(".work-context-strip")
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({
          path: "/workspace/manufacturing-review/failed-route.png",
          fullPage: true,
        });
        throw Error(
          route +
            ": " +
            String(error) +
            " URL=" +
            page.url() +
            " body=" +
            (await page.locator("body").innerText()).slice(-2000),
        );
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      true,
      route + " has no page overflow",
    );
    assert.equal(
      await page.getByText("Workspace unavailable.").count(),
      0,
      route,
    );
  }
  await page.goto(origin + "/dashboard/production/formulas");
  await page.getByRole("button", { name: "New formula", exact: true }).click();
  const formBody = page.getByRole("dialog").locator(".erp-form-body");
  assert.ok(
    await formBody.evaluate((el) => el.scrollHeight > el.clientHeight),
    "long mobile forms have a scrollable body",
  );
  await formBody.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await capture("operations-formula-mobile-bottom");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/production/orders");
  await page.locator(".work-context-strip").waitFor();
  await capture("operations-orders-desktop");
  const wasDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await capture("operations-orders-dark");
  await accessible();
  if (!wasDark)
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
  assert.ok(user);
}
