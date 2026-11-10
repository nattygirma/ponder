import { expect, test } from "@playwright/test";

test("starts at the note list after a renderer failure instead of reopening the previous note", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ponder.renderer-recovery-required", "1");
  });
  await page.goto("/");

  await expect(page.getByRole("status").getByText("Safe startup mode is active")).toBeVisible();
  const firstMemo = page.locator("[data-memo-id]").first();
  await expect(firstMemo).toBeVisible();
  await firstMemo.click();

  await expect(page.getByText("Safe startup mode is active")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ponder.renderer-recovery-required"))).toBeNull();
});
