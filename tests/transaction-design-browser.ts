import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseTransactionDesign(
  page: Page,
  db: Client,
  origin: string,
  actor: string,
  capture: (name: string) => Promise<void>,
) {
  const key = randomUUID();
  const party = (
    await db.query("insert into erp_customers(name) values($1) returning id", [
      "Design customer " + key,
    ])
  ).rows[0].id;
  const quote = (
    await db.query(
      `insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]','{"total":"60000000"}',$4) returning id`,
      ["Q-DESIGN-" + key, key, party, actor],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      [
        "SO-DESIGN-" + key,
        quote,
        key,
        {
          customer: { name: "Design customer" },
          currency: "IDR",
          totals: { total: "60000000" },
          lines: [],
        },
      ],
    )
  ).rows[0].id;
  const command = async (action: string, data: Record<string, unknown>) => {
    const response = await page.request.post(
      origin + "/api/operations/" + action,
      { data: { request_key: randomUUID(), ...data }, headers: { origin } },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const warehouse = await command("save_warehouse", {
    code: "VD-" + key.slice(0, 8),
    name: "Design warehouse " + key.slice(0, 8),
    address: "Main site",
    active: true,
  });
  const location = await command("save_warehouse_location", {
    code: "VL-" + key.slice(0, 8),
    name: "Design storage " + key.slice(0, 8),
    warehouse_id: warehouse.id,
    bin: "A-01",
    active: true,
  });
  const pallet = await command("create_pallet", {
    location_id: location.id,
    notes: "Design fixture",
  });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/dashboard/sales?view=orders&record=" + order);
    await page.locator(".record-overview").waitFor();
    await page.locator(".document-journey-card").first().waitFor();
    assert.equal(await page.locator(".document-journey-card").count(), 2);
    const dialog = page.getByRole("dialog").first();
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
      "record detail fits viewport",
    );
    await capture("transaction-detail-" + width);
    await page
      .locator(".document-journey-card")
      .filter({ hasText: "Q-DESIGN-" })
      .click();
    await page.waitForURL((url) => url.searchParams.get("record") === quote);
    await page.locator(".record-overview").waitFor();
    await page.goto(origin + "/dashboard/warehouse/pallets");
    await page
      .getByRole("button", { name: "Visual overview", exact: true })
      .click();
    await page.locator(".warehouse-board").waitFor();
    assert.equal(
      await page
        .locator(".warehouse-board")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
      "warehouse overview fits viewport",
    );
    await capture("warehouse-overview-" + width);
    await page.locator(".warehouse-visual-card").first().click();
    await page.locator(".record-overview").waitFor();
    await page.goto(origin + "/dashboard/sales?view=quotes");
    await page
      .getByRole("button", { name: "New quotation", exact: true })
      .click();
    await page.locator(".context-summary").waitFor();
    assert.equal(
      await page
        .locator(".context-summary")
        .evaluate((el) => (el as HTMLDetailsElement).open),
      width >= 1100,
    );
    if (width >= 1100) {
      const summary = await page.locator(".context-summary").boundingBox();
      const main = await page.locator(".context-form-main").boundingBox();
      assert.ok(
        summary && main && summary.x >= main.x + main.width,
        "summary occupies its own desktop column",
      );
    }
    await capture("contextual-form-" + width);
  }
  await page.goto(origin + "/dashboard/warehouse/pallets?record=" + pallet.id);
  await page.locator(".record-overview").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await capture("pallet-detail-dark-mobile");
  await page.goto(origin + "/dashboard/quality");
}
