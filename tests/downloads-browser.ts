import assert from "node:assert/strict";
import type { Page } from "playwright";

export async function exerciseDownloads(page: Page, origin: string) {
  await page.goto(origin + "/dashboard/master-data/products");
  const table = page.locator(".advanced-table");
  await table.locator("tbody tr").first().waitFor();
  let release!: () => void,
    observe!: () => void,
    requests = 0;
  const seen = new Promise<void>((resolve) => {
    observe = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = "**/api/export?**";
  await page.route(pattern, async (route) => {
    requests++;
    observe();
    await held;
    await route.fulfill({
      status: 200,
      contentType: "text/csv",
      headers: {
        "Content-Disposition": 'attachment; filename="filtered-products.csv"',
      },
      body: "Product\nINDOSTER 01\n",
    });
  });
  try {
    const csv = table.getByRole("button", { name: "CSV", exact: true });
    await csv.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
    const preparing = table.getByRole("button", {
      name: "Preparing CSV…",
      exact: true,
    });
    await preparing.waitFor();
    assert.equal(await preparing.isDisabled(), true);
    assert.equal(await preparing.getAttribute("aria-busy"), "true");
    assert.equal(
      await table
        .getByRole("button", { name: "Excel", exact: true })
        .isDisabled(),
      true,
    );
    await seen;
    assert.equal(requests, 1, "Double click must not start a second export");
    const downloaded = page.waitForEvent("download");
    release();
    assert.equal(
      (await downloaded).suggestedFilename(),
      "filtered-products.csv",
    );
    await page.waitForFunction(
      () =>
        document.querySelector('.advanced-table button[aria-busy="true"]') ===
        null,
    );
    assert.equal(await csv.isDisabled(), false);
  } finally {
    release();
    await page.unroute(pattern);
  }
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Export temporarily unavailable. Retry.",
      }),
    }),
  );
  await table.getByRole("button", { name: "Excel", exact: true }).click();
  await page
    .getByText("Export temporarily unavailable. Retry.", { exact: true })
    .waitFor();
  assert.equal(
    await table
      .getByRole("button", { name: "Excel", exact: true })
      .isDisabled(),
    false,
  );
  await page.unroute(pattern);
  await page.setViewportSize({ width: 390, height: 844 });
  await table.getByRole("button", { name: "CSV", exact: true }).waitFor();
  assert.ok(
    await table.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
}
