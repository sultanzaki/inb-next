import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Client } from "pg";
import { submitControl } from "./confirmation-browser";
export async function exerciseOperatorWorkflow(
  page: Page,
  db: Client,
  origin: string,
) {
  await db.query("update erp_modules set state='active'");
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(origin + "/dashboard/production/formulas");
  await page.evaluate(() => localStorage.setItem("inb:form-layout", "guided"));
  await page.getByRole("button", { name: "New formula", exact: true }).click();
  let form = page.getByRole("dialog", { name: "New formula", exact: true });
  await form
    .getByRole("textbox", { name: "Formula name", exact: true })
    .fill("Recovered operator formula");
  await page.screenshot({
    path: `${process.env.TEST_ARTIFACT_DIR || "/workspace/operator-review"}/guided-form-mobile.png`,
  });
  assert.equal(
    await form.getByRole("button", { name: "Save", exact: true }).isVisible(),
    false,
    "save is reserved for the review step",
  );
  await form.getByRole("button", { name: "Continue", exact: true }).click();
  await form.getByRole("combobox", { name: "Material", exact: true }).waitFor();
  await form
    .getByText("Draft saved on this device.", { exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "New formula", exact: true }).click();
  form = page.getByRole("dialog", { name: "New formula", exact: true });
  await form
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  assert.equal(
    await form
      .getByRole("textbox", { name: "Formula name", exact: true })
      .inputValue(),
    "Recovered operator formula",
  );
  if (
    await form
      .getByRole("button", { name: "Show all fields", exact: true })
      .count()
  )
    await form
      .getByRole("button", { name: "Show all fields", exact: true })
      .click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await form.locator('[aria-invalid="true"]').first().waitFor();
  assert.equal(
    await form
      .locator('[aria-invalid="true"]')
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
    "invalid fields remain reachable after step validation",
  );
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await submitControl(
    page.getByRole("dialog", { name: "Discard changes?", exact: true }),
    "Discard changes",
  );
  await page.locator(".work-command").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "New formula", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .count(),
    0,
    "explicit discard removes recovered work",
  );
  await page.goto(origin + "/dashboard/sales?view=quotes");
  await page.evaluate(() => localStorage.setItem("inb:form-layout", "guided"));
  await page
    .getByRole("button", { name: "New quotation", exact: true })
    .click();
  const quotation = page.getByRole("dialog");
  await quotation
    .getByRole("button", { name: "Customer", exact: true })
    .waitFor();
  assert.equal(
    await quotation
      .getByRole("button", { name: "Product", exact: true })
      .isVisible(),
    false,
  );
  await quotation
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await quotation
    .getByRole("button", { name: "Product", exact: true })
    .waitFor();
  await quotation
    .getByRole("button", { name: "Review information", exact: true })
    .click();
  await quotation
    .getByRole("button", { name: "Save quotation draft", exact: true })
    .waitFor();
  await page.screenshot({
    path: `${process.env.TEST_ARTIFACT_DIR || "/workspace/operator-review"}/guided-quotation-review.png`,
  });
  await page.goto(origin + "/dashboard/sales?view=customers");
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  form = page.getByRole("dialog");
  await form
    .getByLabel("Company name", { exact: true })
    .fill("Operator recovery customer");
  await form
    .getByText("Draft saved on this device.", { exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Company name", { exact: true }).inputValue(),
    "Operator recovery customer",
  );
  let requests = 0;
  await page.route("**/api/erp/save_customer", async (route) => {
    requests++;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Save outcome not confirmed", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save", exact: true }).isDisabled(),
    true,
  );
  assert.equal(requests, 1, "an ambiguous save is never automatically retried");
  await page.unroute("**/api/erp/save_customer");
  await page
    .getByRole("button", {
      name: "I checked the record — enable retry",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("form.erp-form").waitFor({ state: "detached" });
  await page.goto(origin + "/dashboard/sales?view=customers");
  // Toolbar controls fit a narrow viewport and the filter drawer stays scrollable.
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 568 });
    const tools = page.getByRole("toolbar", {
      name: "Table tools",
      exact: true,
    });
    await tools.waitFor();
    assert.equal(
      await tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await tools.getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.locator(".grid-settings-sheet");
    await sheet.waitFor();
    assert.equal(
      await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await page.keyboard.press("Escape");
  }
  const customerPrefix = "OP-POS-" + Date.now();
  await db.query(
    "insert into erp_customers(name) select $1 || n::text from generate_series(1,80) n",
    [customerPrefix],
  );
  await page.goto(origin + "/dashboard/sales?view=customers");
  await page
    .getByPlaceholder("Search records…", { exact: true })
    .fill(customerPrefix);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  await page.waitForTimeout(1100);
  await page.goto(origin + "/dashboard/workspaces");
  await page.goto(origin + "/dashboard/sales?view=customers");
  await page.waitForFunction(
    (prefix) =>
      (
        document.querySelector(
          'input[placeholder="Search records…"]',
        ) as HTMLInputElement
      )?.value === prefix,
    customerPrefix,
  );
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[aria-label="Previous page"]',
    );
    return button && !button.disabled;
  });
  assert.equal(
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .isEnabled(),
    true,
    "restored results remain on page two",
  );
  await page.getByPlaceholder("Search records…", { exact: true }).fill("");
  // An explicit search URL wins; returning to a bare workspace restores its prior search.
  await page.goto(origin + "/dashboard/production/formulas");
  const search = page.getByPlaceholder(/Search formulas/i);
  await search.fill("operator-position");
  await page.waitForTimeout(1100);
  await page.goto(origin + "/dashboard/workspaces");
  await page.goto(origin + "/dashboard/production/formulas");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("input")).some(
      (input) => input.value === "operator-position",
    ),
  );
  await search.fill("");
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("inb:draft:")) localStorage.removeItem(key);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/dashboard/quality");
}
