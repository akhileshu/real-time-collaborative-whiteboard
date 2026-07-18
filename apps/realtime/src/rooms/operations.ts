import type { SceneOperation, WireShape } from "@whiteboard/contracts";

export type OperationApplyResult =
  | { ok: true; scene: readonly WireShape[] }
  | { ok: false; code: "invalid-operation"; message: string };

export function applySceneOperation(
  scene: readonly WireShape[],
  operation: SceneOperation,
): OperationApplyResult {
  if (operation.kind === "create") {
    if (scene.length >= 10_000) {
      return {
        ok: false,
        code: "invalid-operation",
        message: "The room has reached its shape limit.",
      };
    }
    if (scene.some((shape) => shape.id === operation.shape.id)) {
      return {
        ok: false,
        code: "invalid-operation",
        message: "The shape ID already exists in this room.",
      };
    }

    return { ok: true, scene: [...scene, operation.shape] };
  }

  let found = false;
  const nextScene = scene.map((shape) => {
    if (shape.id !== operation.shapeId) return shape;

    found = true;
    return shape.type === "rectangle"
      ? { ...shape, position: operation.position }
      : { ...shape, center: operation.position };
  });

  if (!found) {
    return {
      ok: false,
      code: "invalid-operation",
      message: "The target shape does not exist in this room.",
    };
  }

  return { ok: true, scene: nextScene };
}
