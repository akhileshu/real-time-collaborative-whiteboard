import { expect, test } from "@playwright/test";

test("saves a board and reloads its scene from PostgreSQL", async ({ browser }) => {
  const roomId = `saved-${Date.now()}`;
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();

  try {
    await firstPage.goto(`/whiteboard?room=${roomId}`);
    await expect(firstPage.getByRole("status", { name: "Room connection status" })).toContainText(
      "Shared document synchronized",
    );

    const canvas = firstPage.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await firstPage.getByRole("button", { name: "Rectangle tool" }).click();
    await firstPage.mouse.click(bounds!.x + 700, bounds!.y + 320);
    await expect(firstPage.locator('[aria-label="Scene description"] li')).toHaveCount(3);

    await firstPage.getByRole("button", { name: "Save board" }).click();
    await expect(firstPage.getByRole("status", { name: "Board persistence status" })).toContainText(
      "Board saved",
    );
  } finally {
    await firstContext.close();
  }

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.goto(`/whiteboard?room=${roomId}`);
    await expect(secondPage.getByRole("status", { name: "Board persistence status" })).toContainText(
      "Saved board loaded",
    );
    await expect(secondPage.getByRole("status", { name: "Room connection status" })).toContainText(
      "Shared document synchronized",
    );
    await expect(secondPage.locator('[aria-label="Scene description"] li')).toHaveCount(3);
  } finally {
    await secondContext.close();
  }
});

test("flushes an accepted document update without an explicit browser save", async ({ browser }) => {
  const roomId = `buffered-${Date.now()}`;
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`/whiteboard?room=${roomId}`);
    await expect(page.getByRole("status", { name: "Room connection status" })).toContainText(
      "Shared document synchronized",
    );

    const canvas = page.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.getByRole("button", { name: "Rectangle tool" }).click();
    await page.mouse.click(bounds!.x + 700, bounds!.y + 280);
    await expect(page.locator('[aria-label="Scene description"] li')).toHaveCount(3);

    await page.waitForTimeout(1_500);
    await page.reload();
    await expect(page.getByRole("status", { name: "Board persistence status" })).toContainText(
      "Saved board loaded",
    );
    await expect(page.locator('[aria-label="Scene description"] li')).toHaveCount(3);
  } finally {
    await context.close();
  }
});
