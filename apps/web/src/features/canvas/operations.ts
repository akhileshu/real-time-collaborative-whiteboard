import type { Scene, ScenePoint, Shape } from "./model";
import type { SceneOperation } from "@whiteboard/contracts";

function isFinitePoint(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function applyRemoteOperation(
  scene: Scene,
  operation: SceneOperation,
): Scene {
  if (operation.kind === "create") {
    if (scene.some((shape) => shape.id === operation.shape.id)) return scene;
    return [...scene, operation.shape as Shape];
  }

  if (!isFinitePoint(operation.position)) return scene;
  let changed = false;
  const nextScene = scene.map((shape) => {
    if (shape.id !== operation.shapeId) return shape;

    changed = true;
    return shape.type === "rectangle"
      ? { ...shape, position: operation.position }
      : { ...shape, center: operation.position };
  });

  return changed ? nextScene : scene;
}
