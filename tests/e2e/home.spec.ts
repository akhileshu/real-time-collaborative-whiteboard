import { expect, test } from "@playwright/test";

test("creates and reloads a todo through tRPC", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();

  const title = `Verify the T3 stack ${Date.now()}`;
  await page.getByLabel("Todo title").fill(title);
  await page.getByRole("button", { name: "Add todo" }).click();

  await expect(page.getByText(title)).toBeVisible();

  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
});
