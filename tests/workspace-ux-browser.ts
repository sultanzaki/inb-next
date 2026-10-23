import assert from "node:assert/strict";
import type { Page } from "playwright";
export async function assertAffixes(page: Page) {
  for (const affix of await page.locator(".input-affix").all()) {
    const geometry = await affix.evaluate((el) => {
      const input = el.querySelector("input")!;
      return {
        display: getComputedStyle(el).display,
        outer: el.getBoundingClientRect().height,
        input: input.getBoundingClientRect().height,
      };
    });
    assert.equal(
      geometry.display,
      "flex",
      "numeric adornments stay beside the input",
    );
    assert.ok(
      geometry.outer <= geometry.input + 3,
      "numeric adornments do not stack above or below the value",
    );
  }
}
export async function exerciseWorkspaceUX(
  page: Page,
  origin: string,
  capture: (name: string) => Promise<void>,
) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/workspaces");
  const launcher = page.getByRole("navigation", {
    name: "All workspaces",
    exact: true,
  });
  const columns = await launcher.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  assert.equal(columns, 4, "desktop directory uses four columns");
  await capture("workspace-directory-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await launcher.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    ),
    2,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  await capture("workspace-directory-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/warehouse/inventory");
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await nav.getByText("Quality", { exact: true }).click();
  assert.equal(await nav.locator(":scope > details[open]").count(), 1);
  await nav.getByText("Inspections & release", { exact: true }).click();
  await Promise.all([
    page.waitForURL("**/dashboard/quality/incoming-inspections"),
    nav
      .getByRole("link", { name: "Incoming inspections", exact: true })
      .click(),
  ]);
  await page.locator(".work-context-strip").waitFor();
  assert.equal(
    await nav
      .getByRole("link", { name: "Incoming inspections", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  await nav.getByRole("searchbox", { name: "Find a page" }).fill("pallet");
  await Promise.all([
    page.waitForURL("**/dashboard/warehouse/pallets"),
    nav.getByRole("link", { name: "Pallet tracking", exact: true }).click(),
  ]);
  await page.locator(".work-context-strip").waitFor();
  assert.match(page.url(), /warehouse\/pallets/);
  assert.equal(await nav.getByRole("searchbox").inputValue(), "");
  assert.equal(await nav.locator(":scope > details[open]").count(), 1);
  await capture("workspace-sidebar-grouped");
  await page.goto(origin + "/dashboard/sales?view=quotes");
  await page
    .getByRole("button", { name: "New quotation", exact: true })
    .click();
  await assertAffixes(page);
  await capture("workspace-quotation-affixes");
  await page.goto(origin + "/dashboard/finance?view=payments");
  await nav.getByRole("link", { name: "Payments", exact: true }).waitFor();
  assert.equal(
    await nav.locator('[aria-current="page"]').count(),
    1,
    "only the selected finance tab is active",
  );
  assert.equal(
    await nav
      .getByRole("link", { name: "Payments", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
}
