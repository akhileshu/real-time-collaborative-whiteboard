"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneOperation } from "@whiteboard/contracts";
import type { Ref } from "react";

import {
  clientToScenePoint,
  createCircle,
  createRectangle,
  hitTest,
  moveShape,
} from "./interaction";
import type { ActiveDrag, CanvasTool } from "./interaction";
import { CanvasSurface } from "./canvas-surface";
import type { CanvasSurfaceHandle } from "./canvas-surface";
import { DEFAULT_VIEWPORT } from "./geometry";
import type { Scene, ScenePoint, Shape } from "./model";
import type { CursorLayerHandle } from "../collaboration/cursor-layer";

type InteractiveCanvasProps = {
  initialScene: Scene;
  ariaLabel: string;
  scene?: Scene;
  clientId?: string;
  disabled?: boolean;
  onLocalOperation?: (operation: SceneOperation) => void;
  onCursorMove?: (point: ScenePoint) => void;
  onCursorLeave?: () => void;
  cursorLayerRef?: Ref<CursorLayerHandle>;
};

function isFinitePoint(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function shapePosition(shape: Shape): ScenePoint {
  return shape.type === "rectangle" ? shape.position : shape.center;
}

function formatPoint(point: ScenePoint): string {
  return `x ${Math.round(point.x)}, y ${Math.round(point.y)}`;
}

function grabOffset(shape: Shape, point: ScenePoint): ScenePoint {
  const position = shapePosition(shape);
  return { x: point.x - position.x, y: point.y - position.y };
}

function nextOperationId(): string {
  return globalThis.crypto.randomUUID();
}

export function InteractiveCanvas({
  initialScene,
  ariaLabel,
  scene: controlledScene,
  clientId,
  disabled = false,
  onLocalOperation,
  onCursorMove,
  onCursorLeave,
  cursorLayerRef,
}: InteractiveCanvasProps) {
  const [localScene, setLocalScene] = useState<Scene>(initialScene);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [status, setStatus] = useState("Select a shape or choose Rectangle tool to add one.");
  const surfaceRef = useRef<CanvasSurfaceHandle>(null);
  const currentScene = controlledScene ?? localScene;
  const committedSceneRef = useRef(currentScene);
  const draftSceneRef = useRef(currentScene);
  const activePointerRef = useRef<ActiveDrag | null>(null);
  const nextRectangleIdRef = useRef(2);

  committedSceneRef.current = currentScene;
  if (!activePointerRef.current) draftSceneRef.current = currentScene;

  const releasePointerCapture = (
    canvas: HTMLCanvasElement,
    pointerId: number,
  ) => {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      activePointerRef.current
    ) {
      return;
    }

    const point = clientToScenePoint(
      event,
      event.currentTarget.getBoundingClientRect(),
      DEFAULT_VIEWPORT,
    );
    if (!isFinitePoint(point)) return;

    const committedScene = committedSceneRef.current;
    const hitShapeId = hitTest(committedScene, point);
    let nextScene = committedScene;
    let shapeId = hitShapeId;

    if (tool === "rectangle" || tool === "circle") {
      if (hitShapeId) return;

      let nextId: string;
      do {
        const localId = `${tool}-${nextRectangleIdRef.current++}`;
        nextId = clientId ? `${clientId}:${localId}` : localId;
      } while (committedScene.some((shape) => shape.id === nextId));

      const created =
        tool === "circle"
          ? createCircle(committedScene, point, nextId)
          : createRectangle(committedScene, point, nextId);
      if (!created.shapeId) return;
      nextScene = created.scene;
      shapeId = created.shapeId;
    }

    if (!shapeId) return;
    const shape = nextScene.find((candidate) => candidate.id === shapeId);
    if (!shape) return;

    const activeDrag: ActiveDrag = {
      pointerId: event.pointerId,
      shapeId,
      grabOffset: grabOffset(shape, point),
      originalScene: committedScene,
    };

    activePointerRef.current = activeDrag;
    draftSceneRef.current = nextScene;
    setSelectedShapeId(shapeId);
    surfaceRef.current?.setScene(nextScene);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!disabled && event.isPrimary) {
      const cursorPoint = clientToScenePoint(
        event,
        event.currentTarget.getBoundingClientRect(),
        DEFAULT_VIEWPORT,
      );
      if (isFinitePoint(cursorPoint)) onCursorMove?.(cursorPoint);
    }

    const activeDrag = activePointerRef.current;
    if (
      !activeDrag ||
      activeDrag.pointerId !== event.pointerId ||
      !event.isPrimary
    ) {
      return;
    }

    const point = clientToScenePoint(
      event,
      event.currentTarget.getBoundingClientRect(),
      DEFAULT_VIEWPORT,
    );
    if (!isFinitePoint(point)) return;

    const nextScene = moveShape(
      draftSceneRef.current,
      activeDrag.shapeId,
      point,
      activeDrag.grabOffset,
    );
    draftSceneRef.current = nextScene;
    surfaceRef.current?.setScene(nextScene);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const activeDrag = activePointerRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    releasePointerCapture(event.currentTarget, event.pointerId);
    const finalScene = draftSceneRef.current;
    const movedShape = finalScene.find(
      (shape) => shape.id === activeDrag.shapeId,
    );
    activePointerRef.current = null;
    setLocalScene(finalScene);
    if (movedShape) {
      const action = tool === "select" ? "Moved" : "Created";
      setStatus(`${action} ${movedShape.id} at ${formatPoint(shapePosition(movedShape))}`);
      if (onLocalOperation) {
        onLocalOperation(
          tool === "select"
            ? {
                kind: "move",
                operationId: nextOperationId(),
                clientId: clientId ?? "local-client",
                shapeId: movedShape.id,
                position: shapePosition(movedShape),
              }
            : {
                kind: "create",
                operationId: nextOperationId(),
                clientId: clientId ?? "local-client",
                shape: movedShape,
              },
        );
      }
    }
    if (tool !== "select") setTool("select");
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    onCursorLeave?.();
    const activeDrag = activePointerRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    releasePointerCapture(event.currentTarget, event.pointerId);
    activePointerRef.current = null;
    draftSceneRef.current = activeDrag.originalScene;
    surfaceRef.current?.setScene(activeDrag.originalScene);
    setSelectedShapeId(null);
    setStatus("Cancelled interaction; the scene was restored.");
  };

  const handlePointerLeave = () => {
    onCursorLeave?.();
  };

  useEffect(() => {
    return () => {
      activePointerRef.current = null;
      draftSceneRef.current = committedSceneRef.current;
    };
  }, []);

  const handleCreateTool = () => {
    if (disabled) return;
    setTool("rectangle");
    setStatus("Rectangle tool selected. Press an empty canvas area to create a shape.");
  };

  const handleCircleTool = () => {
    if (disabled) return;
    setTool("circle");
    setStatus("Circle tool selected. Press an empty canvas area to create one.");
  };

  const handleSelectTool = () => {
    if (disabled) return;
    setTool("select");
    setStatus("Select tool selected. Press and drag a shape to move it.");
  };

  return (
    <section aria-label="Whiteboard editor" className="w-full max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Select tool"
          aria-pressed={tool === "select"}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          onClick={handleSelectTool}
          disabled={disabled}
        >
          Select
        </button>
        <button
          type="button"
          aria-label="Rectangle tool"
          aria-pressed={tool === "rectangle"}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          onClick={handleCreateTool}
          disabled={disabled}
        >
          Rectangle
        </button>
        <button
          type="button"
          aria-label="Circle tool"
          aria-pressed={tool === "circle"}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          onClick={handleCircleTool}
          disabled={disabled}
        >
          Circle
        </button>
        {selectedShapeId ? (
          <span className="text-sm text-muted-foreground">
            Selected {selectedShapeId}
          </span>
        ) : null}
      </div>
      <p
        role="status"
        aria-label="Canvas interaction status"
        aria-live="polite"
        className="mb-3 min-h-5 text-sm text-muted-foreground"
      >
        {status}
      </p>
      <CanvasSurface
        ref={surfaceRef}
        scene={currentScene}
        ariaLabel={ariaLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        cursorLayerRef={cursorLayerRef}
      />
    </section>
  );
}
