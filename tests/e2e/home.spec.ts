import { expect, test } from "@playwright/test";

test("shows the whiteboard workspace shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Real-time collaborative whiteboard",
    }),
  ).toBeVisible();
  await expect(page.getByText("Workspace ready")).toBeVisible();
});
