import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseReleaseReadiness(
  page: Page,
  db: Client,
  origin: string,
  capture: (s: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  async function theme(name: string) {
    await page
      .getByRole("button", { name: "Open account menu", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: name + " theme", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      (selected) =>
        document.documentElement.classList.contains("dark") ===
        (selected === "System"
          ? matchMedia("(prefers-color-scheme: dark)").matches
          : selected === "Dark"),
      name,
    );
  }
  const activation = await page.request.post(origin + "/api/erp/set_module", {
    data: { module: "production", state: "active" },
    headers: { origin },
  });
  assert.equal(activation.status(), 200);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard");
  await theme("Dark");
  for (const route of [
    "dashboard",
    "dashboard/produk",
    "dashboard/inspeksi",
    "dashboard/coa",
    "dashboard/quality",
    "dashboard/purchase",
    "dashboard/crm",
    "dashboard/documents",
    "dashboard/warehouse",
    "dashboard/production",
    "dashboard/sales",
  ]) {
    await page.goto(origin + "/" + route);
    await page.waitForFunction(
      () => document.querySelectorAll("main#main-content").length === 1,
    );
    await page.locator("main").waitFor();
    if (
      ["purchase", "crm", "documents", "warehouse", "production", "sales"].some(
        (m) => route.endsWith("/" + m),
      )
    ) {
      await page.getByRole("button", { name: /Operational insights/ }).click();
      await page.locator(".module-insights-metrics strong").first().waitFor();
      await page
        .getByRole("combobox", { name: "Insights period", exact: true })
        .selectOption("7");
      await page.locator(".module-insights-metrics strong").first().waitFor();
      await page
        .locator(".module-insights-trend summary span")
        .filter({ hasText: "7 days" })
        .waitFor();
      await page.locator(".module-insights-trend summary").click();
      assert.equal(await page.locator(".insights-table tbody tr").count(), 7);
    }
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[role="status"]')].some(
          (el) =>
            /loading/i.test(el.textContent || "") &&
            el.getClientRects().length > 0,
        ),
    );
    await capture("80-dark-" + route.replaceAll("/", "-"));
    await accessible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.goto(origin + "/dashboard/pengguna");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog
    .getByRole("combobox", { name: /Role/ })
    .selectOption("sales_officer");
  await dialog.locator(".access-preview summary").click();
  await dialog.locator(".access-preview-rows").waitFor();
  await capture("81-dark-role-preview");
  await accessible();
  assert.match(
    await dialog.locator(".access-preview-rows").innerText(),
    /sales/i,
  );
  await page.keyboard.press("Escape");
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(origin + "/dashboard/purchase");
    await page.getByRole("button", { name: /Operational insights/ }).click();
    await page.locator(".module-insights-metrics strong").first().waitFor();
    await capture("82-dark-mobile-insights-" + width);
    await accessible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole("button", { name: "New purchase order", exact: true })
      .click();
    await capture("83-dark-mobile-form-" + width);
    await accessible();
    assert.ok(
      await page
        .getByRole("dialog")
        .last()
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.keyboard.press("Escape");
  }
  await page.reload();
  assert.ok(
    await page.locator("html").evaluate((el) => el.classList.contains("dark")),
  );
  await theme("Light");
  assert.equal(
    await page.locator("html").evaluate((el) => el.classList.contains("dark")),
    false,
  );
  await theme("System");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("dark"),
  );
  await theme("Light");
  const savedCookies = await page.context().cookies();
  await theme("Dark");
  await page.context().clearCookies();
  await page.goto(origin + "/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await capture("84-dark-login");
  await accessible();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.context().addCookies(savedCookies);
  await page.goto(origin + "/dashboard");
  // A fresh non-admin session exercises both SSR action visibility and API boundaries.
  const uid = (
      await db.query(
        "insert into users(username,password_hash,role,nama_lengkap) values($1,'fixture','quality_officer','Quality officer fixture') returning id",
        [randomUUID()],
      )
    ).rows[0].id,
    token = randomUUID();
  await db.query(
    "insert into sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
    [uid, token],
  );
  const context = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 375, height: 860 } });
  try {
    await context.addCookies([
      {
        name: "session_token",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const officer = await context.newPage();
    await officer.goto(origin + "/dashboard/inspeksi");
    await officer
      .getByRole("button", { name: "New inspection", exact: true })
      .first()
      .waitFor();
    await officer.goto(origin + "/dashboard/coa");
    await officer
      .getByRole("heading", { name: "Certificate of Analysis" })
      .first()
      .waitFor();
    assert.equal(
      await officer
        .getByRole("button", { name: "Issue COA", exact: true })
        .count(),
      0,
    );
    assert.equal(
      (await context.request.get(origin + "/api/admin/users")).status(),
      403,
    );
    assert.equal(
      (
        await context.request.post(origin + "/api/coa/preview", { data: {} })
      ).status(),
      403,
    );
  } finally {
    await context.close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
