import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
export async function exerciseNumericInput(
  page: Page,
  db: Client,
  origin: string,
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
      "Numeric supplier " + key,
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
      "insert into erp_materials(code,name,unit_id) values($1,'Numeric STEARIC ACID',$2) returning id",
      [key, unit],
    )
  ).rows[0].id;
  const po = (
    await db.query(
      "insert into erp_purchase_orders(number,supplier_id,date,expected_date,currency,created_by) values($1,$2,erp_today(),erp_today(),'IDR',$3) returning id",
      ["PO-NUM-" + key, supplier, actor],
    )
  ).rows[0].id;
  await db.query(
    'insert into erp_purchase_lines(order_id,position,material_id,quantity,price,snapshot) values($1,1,$2,1250.75,12500.25,\'{"name":"Numeric STEARIC ACID","unit":"kg"}\')',
    [po, material],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/dashboard/purchase?view=purchases&record=" + po);
  await page.getByText(/Ordered 1\.250,75/).waitFor();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const dialog = () => page.locator("[role=dialog].erp-dialog").last();
  const quantity = () =>
    dialog().getByRole("textbox", { name: /^Quantity \(/ });
  const price = () => dialog().getByLabel("Unit price", { exact: true });
  assert.equal(await quantity().inputValue(), "1.250,75");
  assert.equal(await price().inputValue(), "12.500,25");
  // Change a grouped existing number in the middle, not just overwrite its value.
  await quantity().focus();
  await quantity().evaluate((el) =>
    (el as HTMLInputElement).setSelectionRange(3, 3),
  );
  await quantity().pressSequentially("9");
  assert.equal(await quantity().inputValue(), "12.950,75");
  assert.equal(
    await quantity().evaluate((el) => (el as HTMLInputElement).selectionStart),
    4,
  );
  await price().fill("12");
  await price().evaluate((el) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "12.");
    input.setSelectionRange(3, 3);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: ".",
      }),
    );
  });
  assert.equal(
    await price().inputValue(),
    "12,",
    "virtual decimal keyboard works without keydown",
  );
  await price().pressSequentially("5");
  assert.equal(await price().inputValue(), "12,5");
  await price().fill("");
  await price().pressSequentially("25000,50");
  assert.equal(await price().inputValue(), "25.000,50");
  assert.match(
    await dialog()
      .getByText(/^Estimated total:/)
      .innerText(),
    /323\.775\.225,375/,
  );
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/erp/save_purchase") &&
      r.request().method() === "POST",
  );
  await dialog()
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  const response = await saved;
  assert.equal(response.status(), 200, await response.text());
  const payload = response.request().postDataJSON();
  assert.equal(payload.lines[0].quantity, "12950.75");
  assert.equal(payload.lines[0].price, "25000.50");
  await dialog().waitFor({ state: "hidden" });
  const line = (
    await db.query(
      "select quantity,price from erp_purchase_lines where order_id=$1",
      [po],
    )
  ).rows[0];
  assert.equal(Number(line.quantity), 12950.75);
  assert.equal(Number(line.price), 25000.5);
  await page.goto(origin + "/dashboard/purchase?view=purchases&record=" + po);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  assert.equal(await quantity().inputValue(), "12.950,75");
  assert.equal(await price().inputValue(), "25.000,5");
  // Untouched database decimals must also pass validation on repeat saves.
  const again = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/erp/save_purchase") &&
      r.request().method() === "POST",
  );
  await dialog()
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  assert.equal((await again).status(), 200);
  await dialog().waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
