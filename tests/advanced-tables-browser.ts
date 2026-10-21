import assert from "node:assert/strict";
import type { Page } from "playwright";
export async function exerciseAdvancedTables(
  page: Page,
  origin: string,
  capture?: (name: string) => Promise<void>,
  accessible?: () => Promise<void>,
) {
  async function settle() {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
  }
  await page.goto(origin + "/dashboard/master-data/products");
  const table = page.locator(".advanced-table");
  await table.locator("tbody tr").first().waitFor();
  await table.getByRole("button", { name: "Filters", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await panel
    .getByLabel("Filter field 1", { exact: true })
    .selectOption("nama_produk");
  await panel
    .getByLabel("Filter operator 1", { exact: true })
    .selectOption("contains");
  await panel.getByLabel("Filter value 1", { exact: true }).fill("E2E Product");
  const filtered = page.waitForResponse(
    (r) =>
      r.url().includes("/api/data/master_produk") && r.url().includes("imatch"),
  );
  await panel
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const filterResponse = await filtered;
  assert.ok(filterResponse.ok(), (await filterResponse.text()).slice(0, 200));
  await table.getByRole("button", { name: "Product", exact: true }).click();
  await table.locator('th[aria-sort="ascending"]').waitFor();
  await table.getByRole("button", { name: "Columns", exact: true }).click();
  await panel
    .getByLabel("Row spacing", { exact: true })
    .selectOption("compact");
  await panel
    .getByRole("checkbox", { name: "Category", exact: true })
    .uncheck();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(
    await table.getByRole("button", { name: "Category", exact: true }).count(),
    0,
  );
  await page.waitForFunction(() =>
    Boolean(document.querySelector(".advanced-table-compact")),
  );
  assert.ok(
    await table.evaluate((el) =>
      el.classList.contains("advanced-table-compact"),
    ),
  );
  const resize = table.getByRole("separator", {
    name: "Resize Product",
    exact: true,
  });
  await resize.focus();
  await resize.press("End");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role=separator][aria-label="Resize Product"]')
        ?.getAttribute("aria-valuenow") === "480",
  );
  const wide = await resize.evaluate(
    (el) => el.closest("th")!.getBoundingClientRect().width,
  );
  await resize.press("Home");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role=separator][aria-label="Resize Product"]')
        ?.getAttribute("aria-valuenow") === "100",
  );
  assert.ok(
    (await resize.evaluate(
      (el) => el.closest("th")!.getBoundingClientRect().width,
    )) < wide,
  );
  await table.getByRole("button", { name: "Views", exact: true }).click();
  await panel
    .getByLabel("View name", { exact: true })
    .fill("Browser filtered products");
  await panel
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() =>
    Boolean(document.querySelector(".advanced-table-compact")),
  );
  await table
    .getByRole("button", { name: "Category", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await table.getByRole("button", { name: "Category", exact: true }).count(),
    0,
  );
  await table.getByRole("button", { name: "Views", exact: true }).click();
  await panel
    .getByRole("button", { name: "Browser filtered products", exact: true })
    .click();
  await table
    .getByRole("button", { name: "Product details", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const response = await page.request.get(
    origin +
      "/api/export?" +
      new URLSearchParams({
        module: "produk",
        format: "csv",
        grid: JSON.stringify({
          filters: [
            { field: "nama_produk", op: "contains", value: "E2E Product" },
          ],
          sorts: [{ field: "nama_produk", direction: "desc" }],
        }),
        columns: "nama_produk,kode_produk",
      }),
  );
  assert.equal(response.status(), 200);
  const csv = await response.text();
  assert.ok(csv.includes('"Product","Code"'));
  assert.ok(csv.indexOf("E2E Product 119") < csv.indexOf("E2E Product 000"));
  const invalid = await page.request.get(
    origin + "/api/export?module=produk&format=csv&columns=password_hash",
  );
  assert.equal(invalid.status(), 400);
  await settle();
  await capture?.("advanced-tables-desktop");
  await accessible?.();
  await page.setViewportSize({ width: 390, height: 844 });
  await table
    .getByRole("button", { name: /^Filters/ })
    .first()
    .click();
  await panel
    .getByRole("heading", { name: "Advanced filters", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await capture?.("advanced-tables-mobile-filters");
  await accessible?.();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  const reset = page.waitForResponse((r) =>
    r.url().includes("/api/data/master_produk"),
  );
  await table.getByRole("button", { name: "Reset", exact: true }).click();
  await reset;
  await settle();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
