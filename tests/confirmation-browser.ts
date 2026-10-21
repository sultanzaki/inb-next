import type { Locator, Page } from "playwright";
/** Keyboard access intentionally needs two steps; Enter alone never confirms. */
export async function submitControl(scope: Locator | Page, label: string) {
  const slider = scope.getByRole("slider", {
    name: label,
    exact: true,
    disabled: false,
  });
  const button = scope.getByRole("button", {
    name: label,
    exact: true,
    disabled: false,
  });
  await slider.or(button).first().waitFor({ state: "visible" });
  if (await slider.count()) {
    await slider.focus();
    await slider.press("End");
    await slider.press("Enter");
  } else await scope.getByRole("button", { name: label, exact: true }).click();
}
