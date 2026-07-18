import type { Scene, ScenePoint, Shape, Viewport } from "./model";

export const NEW_RECTANGLE_SIZE = { width: 120, height: 80 } as const;
export const NEW_CIRCLE_RADIUS = 40;

export type PointerSample = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

export type ActiveDrag = {
  pointerId: number;
  shapeId: string;
  grabOffset: ScenePoint;
  originalScene: Scene;
};

export type CanvasTool = "select" | "rectangle" | "circle";

function isFinitePoint(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function clientToScenePoint(
  sample: Pick<PointerSample, "clientX" | "clientY">,
  bounds: Pick<DOMRect, "left" | "top">,
  viewport: Viewport,
): ScenePoint {
  return {
    x: viewport.origin.x + (sample.clientX - bounds.left) / viewport.zoom,
    y: viewport.origin.y + (sample.clientY - bounds.top) / viewport.zoom,
  };
}

function contains(shape: Shape, point: ScenePoint): boolean {
  if (shape.type === "rectangle") {
    return (
      point.x >= shape.position.x &&
      point.x <= shape.position.x + shape.width &&
      point.y >= shape.position.y &&
      point.y <= shape.position.y + shape.height
    );
  }

  const dx = point.x - shape.center.x;
  const dy = point.y - shape.center.y;
  return dx * dx + dy * dy <= shape.radius * shape.radius;
}

export function hitTest(scene: Scene, point: ScenePoint): string | null {
  if (!isFinitePoint(point)) return null;

  for (let index = scene.length - 1; index >= 0; index -= 1) {
    const shape = scene[index];
    if (shape && contains(shape, point)) return shape.id;
  }

  return null;
}

export function createRectangle(
  scene: Scene,
  center: ScenePoint,
  id: string,
): { scene: Scene; shapeId: string } {
  if (!id || !isFinitePoint(center) || scene.some((shape) => shape.id === id)) {
    return { scene, shapeId: "" };
  }

  const rectangle = {
    id,
    type: "rectangle" as const,
    position: {
      x: center.x - NEW_RECTANGLE_SIZE.width / 2,
      y: center.y - NEW_RECTANGLE_SIZE.height / 2,
    },
    width: NEW_RECTANGLE_SIZE.width,
    height: NEW_RECTANGLE_SIZE.height,
    fill: "#22c55e",
  };

  return { scene: [...scene, rectangle], shapeId: id };
}

export function createCircle(
  scene: Scene,
  center: ScenePoint,
  id: string,
): { scene: Scene; shapeId: string } {
  if (!id || !isFinitePoint(center) || scene.some((shape) => shape.id === id)) {
    return { scene, shapeId: "" };
  }

  const circle = {
    id,
    type: "circle" as const,
    center,
    radius: NEW_CIRCLE_RADIUS,
    fill: "#a855f7",
  };

  return { scene: [...scene, circle], shapeId: id };
}

export function moveShape(
  scene: Scene,
  shapeId: string,
  position: ScenePoint,
  grabOffset: ScenePoint,
): Scene {
  if (!shapeId || !isFinitePoint(position) || !isFinitePoint(grabOffset)) {
    return scene;
  }

  let changed = false;
  const nextScene = scene.map((shape) => {
    if (shape.id !== shapeId) return shape;

    changed = true;
    const nextPosition = {
      x: position.x - grabOffset.x,
      y: position.y - grabOffset.y,
    };

    return shape.type === "rectangle"
      ? { ...shape, position: nextPosition }
      : { ...shape, center: nextPosition };
  });

  return changed ? nextScene : scene;
}
