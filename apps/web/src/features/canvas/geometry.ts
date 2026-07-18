import type { ScenePoint, Viewport } from "./model";

export const DEFAULT_VIEWPORT: Viewport = {
  origin: { x: 0, y: 0 },
  zoom: 1,
};

export function sceneToCanvas(
  point: ScenePoint,
  viewport: Viewport,
): ScenePoint {
  return {
    x: (point.x - viewport.origin.x) * viewport.zoom,
    y: (point.y - viewport.origin.y) * viewport.zoom,
  };
}
