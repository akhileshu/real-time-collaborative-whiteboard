import { describe, expect, it } from "vitest";

import {
  clientToScenePoint,
  createCircle,
  createRectangle,
  hitTest,
  moveShape,
} from "./interaction";
import type { Scene } from "./model";

const scene: Scene = [
  {
    id: "rectangle-1",
    type: "rectangle",
    position: { x: 20, y: 30 },
    width: 120,
    height: 80,
    fill: "#0ea5e9",
  },
  {
    id: "circle-1",
    type: "circle",
    center: { x: 220, y: 100 },
    radius: 40,
    fill: "#f97316",
  },
];

describe("canvas interaction geometry", () => {
  it("converts client coordinates into scene coordinates", () => {
    expect(
      clientToScenePoint(
        { clientX: 130, clientY: 120 },
        { left: 10, top: 20, width: 500, height: 300 } as DOMRect,
        { origin: { x: 5, y: 10 }, zoom: 2 },
      ),
    ).toEqual({ x: 65, y: 60 });
  });

  it("hit-tests rectangles and circles", () => {
    expect(hitTest(scene, { x: 20, y: 30 })).toBe("rectangle-1");
    expect(hitTest(scene, { x: 220, y: 100 })).toBe("circle-1");
    expect(hitTest(scene, { x: 300, y: 100 })).toBeNull();
  });

  it("chooses the visually topmost overlapping shape", () => {
    const overlapping: Scene = [
      scene[0]!,
      {
        id: "circle-1",
        type: "circle",
        center: { x: 80, y: 70 },
        radius: 30,
        fill: "#f97316",
      },
    ];

    expect(hitTest(overlapping, { x: 80, y: 70 })).toBe("circle-1");
  });

  it("creates a fixed rectangle centered at a scene point", () => {
    const result = createRectangle(scene, { x: 300, y: 200 }, "rectangle-2");

    expect(result.shapeId).toBe("rectangle-2");
    expect(result.scene.at(-1)).toMatchObject({
      id: "rectangle-2",
      type: "rectangle",
      position: { x: 240, y: 160 },
      width: 120,
      height: 80,
    });
  });

  it("creates a fixed circle centered at a scene point", () => {
    const result = createCircle(scene, { x: 300, y: 200 }, "circle-2");

    expect(result.shapeId).toBe("circle-2");
    expect(result.scene.at(-1)).toMatchObject({
      id: "circle-2",
      type: "circle",
      center: { x: 300, y: 200 },
      radius: 40,
    });
  });

  it("moves only the target shape while preserving the grab offset", () => {
    const moved = moveShape(scene, "rectangle-1", { x: 100, y: 110 }, { x: 10, y: 20 });

    expect(moved[0]).toMatchObject({ position: { x: 90, y: 90 } });
    expect(moved[1]).toEqual(scene[1]);
  });

  it("returns the original scene for invalid input", () => {
    expect(moveShape(scene, "missing", { x: 10, y: 10 }, { x: 0, y: 0 })).toBe(scene);
    expect(createRectangle(scene, { x: Number.NaN, y: 10 }, "rectangle-2").scene).toBe(scene);
    expect(createCircle(scene, { x: Number.NaN, y: 10 }, "circle-2").scene).toBe(scene);
  });
});
