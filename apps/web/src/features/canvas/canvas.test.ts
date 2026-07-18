import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VIEWPORT,
  sceneToCanvas,
} from "./geometry";
import type { Scene } from "./model";
import { renderScene } from "./renderer";
import { createRenderScheduler } from "./render-scheduler";

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
    center: { x: 260, y: 130 },
    radius: 45,
    fill: "#f97316",
  },
];

function createContextMock() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

describe("canvas scene rendering", () => {
  it("keeps coordinates unchanged with the default viewport", () => {
    expect(sceneToCanvas({ x: 12, y: 18 }, DEFAULT_VIEWPORT)).toEqual({
      x: 12,
      y: 18,
    });
  });

  it("translates and scales scene coordinates", () => {
    expect(
      sceneToCanvas(
        { x: 30, y: 50 },
        { origin: { x: 10, y: 20 }, zoom: 2 },
      ),
    ).toEqual({ x: 40, y: 60 });
  });

  it("renders rectangles and circles without mutating the scene", () => {
    const context = createContextMock();
    const original = structuredClone(scene);

    renderScene(context, scene, DEFAULT_VIEWPORT, { width: 400, height: 240 });

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 400, 240);
    expect(context.fillRect).toHaveBeenCalledWith(20, 30, 120, 80);
    expect(context.arc).toHaveBeenCalledWith(260, 130, 45, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(scene).toEqual(original);
  });

  it("clears an empty scene without drawing shapes", () => {
    const context = createContextMock();

    renderScene(context, [], DEFAULT_VIEWPORT, { width: 400, height: 240 });

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 400, 240);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.arc).not.toHaveBeenCalled();
  });
});

describe("canvas render scheduler", () => {
  it("coalesces invalidations and cancels a pending frame", () => {
    let callback: FrameRequestCallback | undefined;
    const render = vi.fn();
    const scheduler = createRenderScheduler(
      (nextCallback) => {
        callback = nextCallback;
        return 1;
      },
      vi.fn(),
      render,
    );

    scheduler.request();
    scheduler.request();
    expect(render).not.toHaveBeenCalled();

    callback?.(0);
    expect(render).toHaveBeenCalledOnce();

    scheduler.request();
    scheduler.cancel();
    expect(scheduler.hasPendingFrame()).toBe(false);
  });
});
