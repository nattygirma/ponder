import { expect, test, type Page } from "@playwright/test";

const openMemo = async (page: Page, memoId: string, title: string) => {
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByPlaceholder("Search notes").fill(title);
  await page.locator(`[data-memo-id="${memoId}"]`).locator("button").first().click();
};

const deleteLocalDatabase = (page: Page) => page.evaluate(() => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase("ponder-local");
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("Deleting ponder-local was blocked"));
  request.onsuccess = () => resolve();
}));

const readEmergencyDraft = (page: Page, memoId: string) => page.evaluate(
  (id) => window.localStorage.getItem(`ponder.emergency-draft.${id}`),
  memoId,
);

test("preserves the current draft and recovers after IndexedDB is interrupted", async ({ page }) => {
  const marker = `storage-recovery-${Date.now()}`;
  const title = `Storage recovery ${Date.now()}`;
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const createResponse = await page.request.post("/api/v1/memos", {
    data: { notebookId, title, contentMarkdown: "Content before storage interruption" },
  });
  expect(createResponse.status()).toBe(201);
  const memoId = (await createResponse.json() as { memo: { id: string } }).memo.id;

  try {
    await page.goto("/");
    await openMemo(page, memoId, title);

    const editor = page.locator(".ProseMirror[contenteditable='true']");
    await expect(editor).toContainText("Content before storage interruption");
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(` ${marker}`);

    await deleteLocalDatabase(page);

    const storageAlert = page.getByRole("alert").filter({ hasText: "浏览器本地存储无响应" });
    await expect(storageAlert).toBeVisible();
    await expect(page.getByText("Saving", { exact: true })).toHaveCount(0);
    await expect.poll(() => readEmergencyDraft(page, memoId)).toContain(marker);

    await storageAlert.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(storageAlert).toHaveCount(0);
    await expect.poll(() => readEmergencyDraft(page, memoId)).toBeNull();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/memos/${memoId}`);
      if (!response.ok()) return "";
      const body = await response.json() as { memo: { contentJson: unknown } };
      return JSON.stringify(body.memo.contentJson);
    }, { timeout: 20_000 }).toContain(marker);

    await page.reload();
    await openMemo(page, memoId, title);
    await expect(page.locator(".ProseMirror[contenteditable='true']")).toContainText(marker);
  } finally {
    await page.request.delete(`/api/v1/memos/${memoId}`);
    await page.request.delete(`/api/v1/memos/${memoId}?permanent=1`);
  }
});
