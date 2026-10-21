import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
export async function exerciseRecordLoading(
  page: Page,
  db: Client,
  origin: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const token = (await page.context().cookies(origin)).find(
    (c) => c.name === "session_token",
  )!.value;
  const actor = (
    await db.query("select user_id from sessions where token=$1", [token])
  ).rows[0].user_id;
  await db.query(
    "update erp_modules set state='active' where key in ('sales','warehouse')",
  );
  const suffix = randomUUID(),
    number = "SO-LOADING-" + suffix;
  const party = (
    await db.query(
      "insert into erp_customers(name) values('Loading fixture customer') returning id",
    )
  ).rows[0].id;
  const quote = (
    await db.query(
      "insert into erp_quotes(number,root_id,customer_id,date,valid_until,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'accepted','[]','{\"total\":\"100\"}',$4) returning id",
      ["Q-LOADING-" + suffix, suffix, party, actor],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      [
        number,
        quote,
        suffix,
        {
          customer: { name: "Loading fixture customer" },
          totals: { total: "100" },
          lines: [],
        },
      ],
    )
  ).rows[0].id;
  let releasePrimary!: () => void,
    releaseControls!: () => void,
    releaseFlow!: () => void,
    seenControls!: () => void,
    seenFlow!: () => void;
  const primary = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    }),
    controls = new Promise<void>((resolve) => {
      releaseControls = resolve;
    }),
    flow = new Promise<void>((resolve) => {
      releaseFlow = resolve;
    });
  const controlsSeen = new Promise<void>((resolve) => {
      seenControls = resolve;
    }),
    flowSeen = new Promise<void>((resolve) => {
      seenFlow = resolve;
    });
  const mainPattern = "**/api/erp/orders?*id=" + order + "*",
    controlsPattern = "**/api/erp/controls/orders?**",
    flowPattern = "**/api/erp/flow/orders?**";
  await page.route(mainPattern, async (route) => {
    await primary;
    await route.continue();
  });
  await page.route(controlsPattern, async (route) => {
    seenControls();
    await controls;
    await route.continue();
  });
  await page.route(flowPattern, async (route) => {
    seenFlow();
    await flow;
    await route.continue();
  });
  try {
    await page.goto(origin + "/dashboard/sales?view=orders&record=" + order);
    const dialog = page.getByRole("dialog"),
      loading = dialog.getByRole("status", {
        name: "Loading record details…",
        exact: true,
      });
    await loading.waitFor();
    assert.equal(
      await dialog.locator(".record-ready-content").first().isVisible(),
      false,
    );
    releasePrimary();
    await Promise.all([controlsSeen, flowSeen]);
    await loading.waitFor();
    const controlsReady = page.waitForResponse((r) =>
      r.url().includes("/api/erp/controls/orders"),
    );
    releaseControls();
    await controlsReady;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await dialog.getByRole("heading", { name: number, exact: true }).waitFor();
    assert.equal(
      await dialog.locator(".record-ready-content").first().isVisible(),
      false,
      "Linked documents must finish before the record is revealed",
    );
    await capture("record-loading-desktop");
    releaseFlow();
    await loading.waitFor({ state: "hidden" });
    await dialog
      .getByRole("region", { name: "Document controls", exact: true })
      .waitFor();
    await accessible();
  } finally {
    releasePrimary();
    releaseControls();
    releaseFlow();
    await page.unroute(mainPattern);
    await page.unroute(controlsPattern);
    await page.unroute(flowPattern);
  }
  await page.route(controlsPattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Controls temporarily unavailable." }),
    }),
  );
  await page.reload();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Retry controls", exact: true })
    .waitFor();
  assert.ok(
    await dialog.locator(".record-ready-content").first().isVisible(),
    "A failed section must release the skeleton and explain recovery",
  );
  await page.unroute(controlsPattern);
  await dialog
    .getByRole("button", { name: "Retry controls", exact: true })
    .click();
  await dialog
    .getByRole("region", { name: "Document controls", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await capture("record-ready-mobile");
  await accessible();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
