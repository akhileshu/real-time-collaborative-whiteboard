import { expect, test } from "@playwright/test";

test("renders the local scene and survives a viewport resize", async ({ page }) => {
  await page.goto("/whiteboard?room=resize-test");
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Connected to resize-test");

  const canvas = page.getByRole("img", {
    name: "Whiteboard canvas with 2 shapes",
  });

  await expect(canvas).toBeVisible();
  await expect(page.getByText("Rectangle rectangle-1")).toBeVisible();
  await expect(page.getByText("Circle circle-1")).toBeVisible();

  const initialSize = await canvas.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  expect(initialSize.width).toBeGreaterThan(0);
  expect(initialSize.height).toBeGreaterThan(0);

  const renderedImage = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );
  expect(renderedImage.length).toBeGreaterThan(500);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(canvas).toBeVisible();

  const resized = await canvas.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  expect(resized.width).toBeGreaterThan(0);
  expect(resized.height).toBeGreaterThan(0);
});

test("creates and drags a rectangle with pointer capture", async ({ page }) => {
  await page.goto("/whiteboard?room=pointer-test");

  const canvas = page.getByRole("img", {
    name: "Whiteboard canvas with 2 shapes",
  });
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Connected to pointer-test");
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Shared document synchronized");
  const status = page.getByRole("status", { name: "Canvas interaction status" });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();

  await page.getByRole("button", { name: "Rectangle tool" }).click();
  const createPoint = {
    x: bounds!.x + 650,
    y: bounds!.y + 300,
  };
  await page.mouse.click(createPoint.x, createPoint.y);

  await expect(page.getByText(/Rectangle client-.*:rectangle-2/)).toBeVisible();
  await expect(status).toContainText("Created client-");

  await page.getByRole("button", { name: "Select tool" }).click();
  await page.mouse.move(createPoint.x, createPoint.y);
  await page.mouse.down();
  await page.mouse.move(createPoint.x + 100, createPoint.y + 50);
  await page.mouse.up();

  await expect(status).toContainText("Moved client-");
  await expect(status).toContainText("at x 690, y 310");

  await page.mouse.move(createPoint.x + 100, createPoint.y + 50);
  await page.mouse.down();
  await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(status).toContainText("Cancelled interaction; the scene was restored.");

  await page.mouse.move(createPoint.x + 100, createPoint.y + 50);
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(status).toContainText(
    `Moved client-`,
  );
  await expect(status).toContainText(
    `at x ${Math.round(10 - bounds!.x - 60)}, y ${Math.round(10 - bounds!.y - 40)}`,
  );
});

test("creates a circle with the Circle tool", async ({ page }) => {
  await page.goto("/whiteboard?room=circle-test");
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Connected to circle-test");
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Shared document synchronized");

  const canvas = page.getByRole("img", {
    name: "Whiteboard canvas with 2 shapes",
  });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();

  await page.getByRole("button", { name: "Circle tool" }).click();
  await page.mouse.click(bounds!.x + 650, bounds!.y + 300);

  await expect(page.getByRole("status", { name: "Canvas interaction status" })).toContainText(/Created .*circle-/);
  await expect(page.locator('[aria-label="Scene description"] li')).toHaveCount(3);
});

test("runs the opt-in canvas interaction harness", async ({ page }) => {
  await page.goto("/whiteboard?room=test-harness");
  await expect(
    page.getByRole("status", { name: "Room connection status" }),
  ).toContainText("Connected to test-harness");

  await page.getByRole("button", { name: "Test canvas interactions" }).click();
  await expect(page.getByRole("timer", { name: "Test canvas interactions timer" })).toHaveText("01:00");
  await expect(page.getByRole("list", { name: "Test canvas interaction activity" })).toContainText(
    "Started randomized canvas interactions",
  );
  await expect(page.getByRole("list", { name: "Test canvas interaction activity" })).toContainText(
    /Moved the cursor around the canvas|Created a rectangle|Moved a shape|Saved the board/,
    { timeout: 8_000 },
  );
  await expect
    .poll(() => page.locator('[aria-label="Scene description"] li').count(), {
      timeout: 12_000,
    })
    .toBeGreaterThan(2);

  await page.getByRole("button", { name: "Stop test canvas interactions" }).click();
  await expect(page.getByRole("button", { name: "Test canvas interactions" })).toBeVisible();
});

test("lists saved boards and navigates when a board is selected", async ({ page }) => {
  const firstRoom = `board-picker-a-${Date.now()}`;
  const secondRoom = `board-picker-b-${Date.now()}`;

  await page.goto(`/whiteboard?room=${firstRoom}`);
  await expect(page.getByRole("status", { name: "Room connection status" })).toContainText(
    `Connected to ${firstRoom}`,
  );
  await page.getByRole("button", { name: "Save board" }).click();
  await expect(page.getByRole("status", { name: "Board persistence status" })).toContainText(
    "Board saved",
  );

  await page.goto(`/whiteboard?room=${secondRoom}`);
  await expect(page.getByRole("status", { name: "Room connection status" })).toContainText(
    `Connected to ${secondRoom}`,
  );
  await page.getByRole("button", { name: "Save board" }).click();
  await expect(page.getByRole("status", { name: "Board persistence status" })).toContainText(
    "Board saved",
  );

  const boardSelect = page.getByRole("combobox", { name: "Select board" });
  await expect(boardSelect).toHaveValue(secondRoom);
  await expect(page.getByLabel("Available boards count")).toHaveText(/\d+ boards/);
  await expect
    .poll(() => boardSelect.locator("option").count())
    .toBeGreaterThanOrEqual(2);

  await boardSelect.selectOption(firstRoom);
  await expect(page).toHaveURL(new RegExp(`/whiteboard\\?room=${firstRoom}$`));
  await expect(page.getByRole("combobox", { name: "Select board" })).toHaveValue(firstRoom);
  await expect(page.getByRole("status", { name: "Room connection status" })).toContainText(
    `Connected to ${firstRoom}`,
  );
});

test("creates a new board from the board picker", async ({ page }) => {
  const newRoom = `new-board-${Date.now()}`;

  await page.goto("/whiteboard?room=demo");
  await page.getByLabel("New board room").fill(newRoom);
  await page.getByRole("button", { name: "Create board" }).click();

  await expect(page).toHaveURL(new RegExp(`/whiteboard\\?room=${newRoom}$`));
  await expect(page.getByRole("combobox", { name: "Select board" })).toHaveValue(newRoom);
  await expect(page.getByRole("status", { name: "Room connection status" })).toContainText(
    `Connected to ${newRoom}`,
  );
});
