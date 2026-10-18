import assert from "node:assert/strict";
import type { Page } from "playwright";
export async function exerciseMobileNavigation(
  page: Page,
  origin: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  for (const width of [375, 320, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(origin + "/dashboard");
    const nav = page.getByRole("navigation", {
      name: "Mobile navigation",
      exact: true,
    });
    await nav
      .getByRole("button", { name: "Switch workspace", exact: true })
      .waitFor();
    assert.equal(await page.locator(".mobile-bottom-nav").count(), 0);
    const search = await nav
        .getByRole("button", { name: "Search", exact: true })
        .boundingBox(),
      account = await nav
        .getByRole("button", { name: "Open account menu", exact: true })
        .boundingBox();
    assert.ok(
      search &&
        account &&
        search.width === 40 &&
        account.width === 40 &&
        Math.abs(search.y - account.y) < 1,
      "header actions share size and baseline",
    );
    await nav
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    const workspaces = page.getByRole("dialog", {
      name: "Workspaces",
      exact: true,
    });
    await workspaces
      .getByRole("link", { name: "Warehouse", exact: true })
      .waitFor();
    await capture("60-mobile-workspaces-" + width);
    await accessible();
    assert.ok(
      await workspaces.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 11 &&
          r.right <= innerWidth - 11 &&
          Math.abs(r.left - (innerWidth - r.right)) < 2
        );
      }),
    );
    await workspaces
      .getByRole("link", { name: "Warehouse", exact: true })
      .click();
    await page.waitForURL("**/dashboard/warehouse?view=stock");
    await nav.getByRole("button", { name: "Choose page", exact: true }).click();
    const pages = page.getByRole("dialog", {
      name: "Workspace pages",
      exact: true,
    });
    await pages
      .getByRole("link", { name: "Stock counts", exact: true })
      .waitFor();
    await capture("61-mobile-pages-" + width);
    await accessible();
    assert.equal(await pages.locator('[aria-current="page"]').count(), 1);
    await pages.getByRole("link", { name: "Returns", exact: true }).click();
    await page.waitForURL("**/dashboard/warehouse?view=returns");
    await page
      .getByRole("button", { name: "Request return", exact: true })
      .waitFor();
    assert.match(
      await nav.getByRole("button", { name: "Choose page" }).innerText(),
      /Returns/,
    );
    await capture("62-mobile-returns-" + width);
    await accessible();
    assert.equal(
      await page.getByRole("combobox", { name: "Workspace view" }).count(),
      0,
    );
    await nav.getByRole("button", { name: "Switch workspace" }).click();
    await workspaces
      .getByRole("link", { name: "Master data", exact: true })
      .click();
    await page.waitForURL("**/dashboard/produk");
    await nav.getByRole("button", { name: "Choose page" }).click();
    await pages.getByRole("link", { name: "Units", exact: true }).click();
    await page.waitForURL("**/dashboard/settings?view=units");
    await page.getByRole("button", { name: "Add unit", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Switch workspace" }).click();
    await workspaces.waitFor();
    await page.keyboard.press("Escape");
    await workspaces.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Switch workspace",
    );
    await nav.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("combobox", { name: "Search all modules" }).waitFor();
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "Open account menu" }).click();
    await page
      .getByRole("menuitem", { name: "Change password", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard");
  await page.locator(".workspace-sidebar").waitFor();
  assert.equal(await page.locator(".mobile-console-header").isVisible(), false);
  assert.equal(await page.locator(".app-topbar").isVisible(), true);
  await capture("63-desktop-navigation-preserved");
  await accessible();
}
