import { sceneToCanvas } from "./geometry";
import type { Scene, Viewport } from "./model";

export function renderScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  viewport: Viewport,
  size: { width: number; height: number },
): void {
  context.clearRect(0, 0, size.width, size.height);

  for (const shape of scene) {
    if (shape.type === "rectangle") {
      const position = sceneToCanvas(shape.position, viewport);
      context.fillStyle = shape.fill;
      context.fillRect(
        position.x,
        position.y,
        shape.width * viewport.zoom,
        shape.height * viewport.zoom,
      );
      continue;
    }

    const center = sceneToCanvas(shape.center, viewport);
    context.fillStyle = shape.fill;
    context.beginPath();
    context.arc(
      center.x,
      center.y,
      shape.radius * viewport.zoom,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}
