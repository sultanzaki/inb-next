import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Client } from "pg";

/** Exercise intermediate states, not just screenshots after animations settle. */
export async function exerciseInteractionStability(
  page: Page,
  db: Client,
  origin: string,
) {
  await db.query("update erp_modules set state='active'");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 568 : 900 });
    await page.goto(origin + "/dashboard/production/formulas");
    await page
      .getByRole("button", { name: "New formula", exact: true })
      .click();
    const form = page.getByRole("dialog", { name: "New formula", exact: true });
    await form.waitFor();
    assert.equal(
      await form.evaluate((el) => getComputedStyle(el).opacity),
      "1",
      "modal surface is opaque even during entry",
    );
    await form.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    const metrics = await form.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: innerWidth,
        height: innerHeight,
        scroll: el.scrollWidth,
        client: el.clientWidth,
      };
    });
    assert.ok(
      metrics.left >= -1 && metrics.right <= metrics.width + 1,
      JSON.stringify(metrics),
    );
    assert.ok(
      metrics.top >= -1 && metrics.bottom <= metrics.height + 1,
      JSON.stringify(metrics),
    );
    assert.ok(
      metrics.scroll <= metrics.client + 1,
      "form must not scroll horizontally",
    );
    await page.screenshot({
      path: `${process.env.TEST_ARTIFACT_DIR ?? "/workspace/redesign-apple-review"}/interaction-form-${width}.png`,
    });
    const pickerTrigger = form.getByRole("combobox", {
      name: "Material",
      exact: true,
    });
    await pickerTrigger.click();
    const picker = page.locator(".work-picker");
    await picker.getByRole("option").first().waitFor();
    const search = picker.getByRole("textbox");
    await search.focus();
    await search.press("ArrowDown");
    assert.equal(
      await picker
        .getByRole("option")
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
      "keyboard moves from search to choices",
    );
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "hidden" });
    assert.equal(
      await pickerTrigger.evaluate((el) => el === document.activeElement),
      true,
      "picker restores focus to its field",
    );
    // Inspect the first exit frame without relying on an animation-length timeout.
    const closingForm = await form.evaluate(async (el) => {
      (
        el.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
      ).click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return el.isConnected
        ? { text: el.textContent, opacity: getComputedStyle(el).opacity }
        : null;
    });
    if (closingForm) {
      assert.match(closingForm.text || "", /New formula/);
      assert.equal(closingForm.opacity, "1", "closing form remains opaque");
    }
    await page
      .locator('[data-slot="dialog-content"]')
      .waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: "New formula", exact: true })
      .click();
    await form.waitFor();
    await form
      .getByRole("textbox", { name: "Formula name", exact: true })
      .fill("Changed title");
    await page.waitForFunction(() =>
      Boolean(document.querySelector('form[data-dirty="true"]')),
    );
    await form.getByRole("button", { name: "Close", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Discard changes?",
      exact: true,
    });
    await confirmation.waitFor();
    await confirmation.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    const closingText = await confirmation.evaluate(async (el) => {
      (
        Array.from(el.querySelectorAll("button")).find(
          (button) => button.textContent === "Back",
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return el.isConnected ? el.textContent : null;
    });
    assert.ok(
      closingText === null || closingText.includes("Discard changes?"),
      "closing confirmation keeps its content until it unmounts",
    );
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(
      await form
        .getByRole("textbox", { name: "Formula name", exact: true })
        .inputValue(),
      "Changed title",
      "canceling discard retains input",
    );
    await page.goto(origin + "/dashboard/production/formulas");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "New formula", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New formula", exact: true });
  await dialog.getByRole("combobox", { name: "Material", exact: true }).click();
  const picker = page.locator(".work-picker");
  await picker.getByRole("option").first().waitFor();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/operations/materials?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("q") === "delayed-search"
    ) {
      await held;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Choices temporarily unavailable." }),
      });
    } else await route.continue();
  });
  try {
    await picker.getByRole("textbox").fill("delayed-search");
    await picker.getByRole("status").waitFor();
    assert.equal(
      await picker.getByRole("option").count(),
      0,
      "old choices disappear as soon as search changes",
    );
    release();
    await picker.getByRole("alert").waitFor();
    assert.match(
      await picker.getByRole("alert").innerText(),
      /Choices temporarily unavailable/,
    );
    await page.unroute("**/api/operations/materials?*");
    await picker.getByRole("button", { name: "Retry", exact: true }).click();
    await picker.getByText("No matching records.").waitFor();
  } finally {
    release();
    await page.unroute("**/api/operations/materials?*");
  }
  await page.goto(origin + "/dashboard/quality");
  await page.setViewportSize({ width: 1440, height: 1000 });
}
