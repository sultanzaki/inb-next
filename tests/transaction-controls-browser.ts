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
  const slider = dialog.getByRole("slider", {
    name: "Approve closure",
    exact: true,
  });
  await slider.click();
  await slider.press("Enter");
  await dialog.getByLabel("Closure reason").press("Enter");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from erp_order_closures where source_id=$1",
        [po],
      )
    ).rows[0].n,
    0,
    "click and Enter alone cannot approve",
  );
  const thumb = (await slider.boundingBox())!;
  const track = (await dialog.locator(".slide-confirm").boundingBox())!;
  await page.mouse.move(thumb.x + 24, thumb.y + 24);
  await page.mouse.down();
  await page.mouse.move(thumb.x + 24 + (track.width - 56) * 0.5, thumb.y + 24, {
    steps: 8,
  });
  await page.mouse.up();
  assert.equal(await slider.getAttribute("aria-valuenow"), "0");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from erp_order_closures where source_id=$1",
        [po],
      )
    ).rows[0].n,
    0,
    "incomplete drag resets without approval",
  );
  await slider.focus();
  await slider.press("End");
  await dialog
    .getByLabel("Closure reason")
    .fill("Supplier cancelled the remaining order after review");
  assert.equal(
    await slider.getAttribute("aria-valuenow"),
    "0",
    "editing the form invalidates an armed confirmation",
  );
  // The same control remains accessible without a pointer; arming alone does not submit.
  await slider.focus();
  await slider.press("End");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from erp_order_closures where source_id=$1",
        [po],
      )
    ).rows[0].n,
    0,
  );
  await slider.press("Home");
  await slider.evaluate(async (el) => {
    el.getBoundingClientRect();
    await Promise.all(
      el.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.mouse.move(thumb.x + 24, thumb.y + 24);
  await page.mouse.down();
  await page.mouse.move(thumb.x + 24 + track.width - 56, thumb.y + 24, {
    steps: 16,
  });
  assert.equal(
    await slider.getAttribute("aria-valuenow"),
    "100",
    "full drag reaches end before release",
  );
  await page.mouse.up();
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
  for (const detail of await page
    .locator('[aria-label="Document history"] details')
    .all())
    await detail.locator("summary").click();
  assert.ok(await page.locator(".history-change-heading").count());
  assert.equal(
    await page
      .locator(".control-history")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  assert.equal(
    await page.locator(".control-diff").filter({ hasText: "→" }).count(),
    0,
  );
  await capture("phase4-history-mobile");
  await accessible();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
