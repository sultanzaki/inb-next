import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
export async function exerciseTransactionControls(
  page: Page,
  db: Client,
  origin: string,
  capture: (s: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const token = (await page.context().cookies(origin)).find(
    (c) => c.name === "session_token",
  )!.value;
  const actor = (
    await db.query("select user_id from sessions where token=$1", [token])
  ).rows[0].user_id;
  await db.query(
    "update erp_modules set state='active' where key in ('purchase','finance')",
  );
  const key = randomUUID();
  const supplier = (
    await db.query("insert into erp_suppliers(name) values($1) returning id", [
      "Closure supplier " + key,
    ])
  ).rows[0].id;
  const unit = (
    await db.query(
      "insert into erp_units(code,name) values($1,'Kilogram') returning id",
      [key.slice(0, 12)],
    )
  ).rows[0].id;
  const material = (
    await db.query(
      "insert into erp_materials(code,name,unit_id) values($1,'Closure STEARIC ACID',$2) returning id",
      [key, unit],
    )
  ).rows[0].id;
  const po = (
    await db.query(
      "insert into erp_purchase_orders(number,supplier_id,date,expected_date,currency,state,created_by) values($1,$2,erp_today(),erp_today(),'IDR','confirmed',$3) returning id",
      ["PO-BROWSER-" + key, supplier, actor],
    )
  ).rows[0].id;
  await db.query(
    'insert into erp_purchase_lines(order_id,position,material_id,quantity,received,price,snapshot) values($1,1,$2,10,0,10,\'{"name":"Closure STEARIC ACID","unit":"kg"}\')',
    [po, material],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/dashboard/purchase?view=purchases&record=" + po);
  await page
    .getByRole("button", { name: "Review closure", exact: true })
    .click();
  const dialog = page.locator("[role=dialog].erp-dialog").last();
  await dialog
    .getByLabel("Closure reason")
    .fill("Supplier cancelled the remaining order");
  await capture("phase4-mobile-closure");
  await accessible();
  assert.equal(
    await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
  );
  await dialog
    .getByRole("button", { name: "Approve closure", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.goto(origin + "/dashboard/purchase?view=purchases&record=" + po);
  await page
    .getByRole("heading", { name: "Remaining quantities closed", exact: true })
    .waitFor();
  const row = (
    await db.query("select state from erp_purchase_orders where id=$1", [po])
  ).rows[0];
  assert.equal(row.state, "closed");
  assert.equal(
    Number(
      (
        await db.query(
          "select quantity from erp_purchase_lines where order_id=$1",
          [po],
        )
      ).rows[0].quantity,
    ),
    10,
  );
  await page
    .getByRole("heading", { name: "Document history", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
