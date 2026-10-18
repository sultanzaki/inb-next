import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseRelease(
  page: Page,
  db: Client,
  origin: string,
  suffix: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  async function post(action: string, payload: unknown) {
    const r = await page.request.post(origin + "/api/erp/" + action, {
      data: payload,
    });
    const d = await r.json();
    assert.equal(r.status(), 200, JSON.stringify(d));
    return d;
  }
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
  async function action(label: string, reason: string) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const d = page.getByRole("dialog").last();
    await d.getByLabel("Reason", { exact: true }).fill(reason);
    await d.getByRole("button", { name: "Confirm", exact: true }).click();
  }
  const p = (
    await db.query("select id from master_produk where kode_produk=$1", [
      "ERP-BROWSER-" + suffix,
    ])
  ).rows[0].id;
  const today = (await db.query("select erp_today()::text d")).rows[0].d,
    kg = (await db.query("select id from erp_units where code='kg'")).rows[0]
      .id,
    loc = (await db.query("select id from erp_locations where code='MAIN'"))
      .rows[0].id;
  const move = await post("save_move", {
    kind: "production",
    date: today,
    to_location: loc,
    reason: "Inspection mobile review",
    lines: [{ product_id: p, unit_id: kg, quantity: "10", mfg_date: today }],
  });
  await post("post_move", { id: move.id, version: 1 });
  const lot = (
    await db.query(
      "select * from erp_lots where product_id=$1 and batch_number=2",
      [p],
    )
  ).rows[0];
  assert.ok(lot);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(origin + "/dashboard/inspeksi?lot=" + lot.id);
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("textbox", { name: "Result pH", exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const r = document
        .querySelector(".inspection-editor")
        ?.getBoundingClientRect();
      return (
        r &&
        r.width >= innerWidth - 2 &&
        r.height >= innerHeight - 2 &&
        r.left >= -1 &&
        r.top >= -1
      );
    });
    const rect = await page.locator(".inspection-editor").boundingBox();
    assert.ok(
      rect && rect.width >= width - 2 && rect.height >= 798,
      "inspection uses the full mobile viewport",
    );
    assert.ok(
      await page
        .locator(".inspection-editor")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page
      .getByRole("textbox", { name: "Result pH", exact: true })
      .fill("7");
    assert.ok(
      await page
        .getByRole("textbox", { name: "Result pH", exact: true })
        .evaluate((el) => el.getBoundingClientRect().width > 200),
    );
    await page
      .getByPlaceholder("Inspector name", { exact: true })
      .fill("Mobile QC inspector");
    await capture("50-inspection-fullscreen-" + width);
    await accessible();
  }
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(
    (await db.query("select qc_status from erp_lots where id=$1", [lot.id]))
      .rows[0].qc_status,
    "released",
  );
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/dashboard");
    await page.locator(".performance-metrics strong").first().waitFor();
    if (width < 768) {
      assert.equal(await page.locator(".app-topbar").isVisible(), true);
      await page
        .getByRole("combobox", { name: "Performance context", exact: true })
        .selectOption("warehouse");
    } else
      await page
        .getByRole("button", { name: "warehouse", exact: true })
        .click();
    await page
      .getByRole("heading", { name: "Posted warehouse movements", exact: true })
      .waitFor();
    await capture("51-dashboard-" + width);
    await accessible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.goto(origin + "/dashboard/work");
    await page
      .locator(".work-directory")
      .getByText("Warehouse", { exact: true })
      .click();
    await capture("52-work-" + width);
    await accessible();
    await page.goto(origin + "/dashboard/warehouse?view=lots");
    await page
      .getByRole("button", { name: lot.number, exact: true })
      .first()
      .click();
    await page.getByRole("heading", { name: "Movement history" }).waitFor();
    await capture("53-lot-trace-" + width);
    await accessible();
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/warehouse?view=returns");
  await page
    .getByRole("button", { name: "Request return", exact: true })
    .click();
  const delivery = (
    await db.query(
      "select id,number from erp_movements where kind='delivery' and state='posted' and lines::text like $1 order by created_at desc limit 1",
      ["%" + p + "%"],
    )
  ).rows[0];
  await pick("Original delivery", delivery.number);
  const form = page.getByRole("dialog").last();
  await form
    .getByLabel("Shipped lot", { exact: true })
    .selectOption({ index: 1 });
  await pick("Return location", "MAIN");
  await form
    .getByLabel("Return quantity (base unit)", { exact: true })
    .fill("1");
  await form
    .getByLabel("Return reason", { exact: true })
    .fill("Packaging inspection");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Status: requested", { exact: true }).waitFor();
  await action("Receive into quarantine", "Returned bag physically received");
  await page.getByText("Status: received", { exact: true }).waitFor();
  await capture("54-return-received");
  await accessible();
  await action("Approve disposal", "Approved damaged package disposal");
  await page.getByText("Status: scrapped", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.goto(origin + "/dashboard/inbox");
  await page
    .getByRole("heading", { name: "Work inbox", exact: true })
    .waitFor();
  await capture("55-work-inbox");
  await accessible();
}
