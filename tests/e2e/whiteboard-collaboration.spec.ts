import { expect, test } from "@playwright/test";

test("converges a shared document between two room members", async ({
  browser,
}) => {
  const roomId = `operations-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await Promise.all([
      pageA.goto(`/whiteboard?room=${roomId}`),
      pageB.goto(`/whiteboard?room=${roomId}`),
    ]);

    const roomStatusA = pageA.getByRole("status", { name: "Room connection status" });
    const roomStatusB = pageB.getByRole("status", { name: "Room connection status" });
    await expect(roomStatusA).toContainText(`Connected to ${roomId}`);
    await expect(roomStatusB).toContainText(`Connected to ${roomId}`);

    const canvasA = pageA.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const boundsA = await canvasA.boundingBox();
    expect(boundsA).not.toBeNull();

    await pageA.getByRole("button", { name: "Rectangle tool" }).click();
    const createPoint = { x: boundsA!.x + 650, y: boundsA!.y + 300 };
    await pageA.mouse.click(createPoint.x, createPoint.y);

    const createdShape = pageA.getByText(/Rectangle client-.*:rectangle-2/);
    await expect(createdShape).toBeVisible();
    await expect(pageB.getByText(/Rectangle client-.*:rectangle-2/)).toBeVisible();

    const canvasB = pageB.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const boundsB = await canvasB.boundingBox();
    expect(boundsB).not.toBeNull();
    await pageB.getByRole("button", { name: "Select tool" }).click();
    await pageB.mouse.move(boundsB!.x + 650, boundsB!.y + 300);
    await pageB.mouse.down();
    await pageB.mouse.move(boundsB!.x + 750, boundsB!.y + 350);
    await pageB.mouse.up();

    await expect(roomStatusA).toContainText("A collaborator updated the shared document");

    await contextB.close();
    await expect(roomStatusA).toContainText("1 members");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("converges concurrent shape creation", async ({ browser }) => {
  const roomId = `concurrent-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await Promise.all([
      pageA.goto(`/whiteboard?room=${roomId}`),
      pageB.goto(`/whiteboard?room=${roomId}`),
    ]);
    await expect(pageA.getByRole("status", { name: "Room connection status" })).toContainText("Shared document synchronized");
    await expect(pageB.getByRole("status", { name: "Room connection status" })).toContainText("Shared document synchronized");

    const canvasA = pageA.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const canvasB = pageB.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const boundsA = await canvasA.boundingBox();
    const boundsB = await canvasB.boundingBox();
    expect(boundsA).not.toBeNull();
    expect(boundsB).not.toBeNull();

    await Promise.all([
      (async () => {
        await pageA.getByRole("button", { name: "Rectangle tool" }).click();
        await pageA.mouse.click(boundsA!.x + 650, boundsA!.y + 300);
      })(),
      (async () => {
        await pageB.getByRole("button", { name: "Rectangle tool" }).click();
        await pageB.mouse.click(boundsB!.x + 760, boundsB!.y + 280);
      })(),
    ]);

    await expect(pageA.locator('[aria-label="Scene description"] li')).toHaveCount(4);
    await expect(pageB.locator('[aria-label="Scene description"] li')).toHaveCount(4);
    await expect.poll(async () => await pageA.locator('[aria-label="Scene description"]').innerText()).toBe(
      await pageB.locator('[aria-label="Scene description"]').innerText(),
    );
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("clears the live shared board for all room members", async ({ browser }) => {
  const roomId = `clear-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await Promise.all([
      pageA.goto(`/whiteboard?room=${roomId}`),
      pageB.goto(`/whiteboard?room=${roomId}`),
    ]);
    await expect(pageA.getByRole("button", { name: "Clear board" })).toBeEnabled();
    await expect(pageB.locator('[aria-label="Scene description"] li')).toHaveCount(2);

    await pageA.getByRole("button", { name: "Clear board" }).click();

    await expect(pageA.locator('[aria-label="Scene description"] li')).toHaveCount(0);
    await expect(pageB.locator('[aria-label="Scene description"] li')).toHaveCount(0);
    await expect(pageA.getByRole("status", { name: "Room connection status" })).toContainText(
      "Board cleared. Save to persist this change.",
    );
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("shows a live cursor and removes it when a room member disconnects", async ({
  browser,
}) => {
  const roomId = `cursor-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await Promise.all([
      pageA.goto(`/whiteboard?room=${roomId}`),
      pageB.goto(`/whiteboard?room=${roomId}`),
    ]);

    await expect(
      pageA.getByRole("status", { name: "Room connection status" }),
    ).toContainText(`Connected to ${roomId}`);
    await expect(
      pageB.getByRole("status", { name: "Room connection status" }),
    ).toContainText(`Connected to ${roomId}`);

    const canvasA = pageA.getByRole("img", { name: "Whiteboard canvas with 2 shapes" });
    const boundsA = await canvasA.boundingBox();
    expect(boundsA).not.toBeNull();

    await pageA.mouse.move(boundsA!.x + 620, boundsA!.y + 280);
    const cursorOnB = pageB.locator('[data-testid="collaborator-cursor"]');
    await expect(cursorOnB).toHaveCount(1);
    const firstPosition = await cursorOnB.boundingBox();
    expect(firstPosition).not.toBeNull();

    await pageA.waitForTimeout(75);
    await pageA.mouse.move(boundsA!.x + 720, boundsA!.y + 280);
    await expect.poll(async () => (await cursorOnB.boundingBox())?.x).not.toBe(firstPosition!.x);

    await contextA.close();
    await expect(cursorOnB).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
