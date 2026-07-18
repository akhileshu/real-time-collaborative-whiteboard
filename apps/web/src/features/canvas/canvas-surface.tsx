"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PointerEventHandler } from "react";
import type { Ref } from "react";

import { DEFAULT_VIEWPORT } from "./geometry";
import { createRenderScheduler } from "./render-scheduler";
import { renderScene } from "./renderer";
import type { Scene, Viewport } from "./model";
import { CursorLayer, type CursorLayerHandle } from "../collaboration/cursor-layer";

const MAX_DEVICE_PIXEL_RATIO = 2;

export type CanvasSurfaceHandle = {
  setScene: (scene: Scene) => void;
};

export type CanvasSurfaceProps = {
  scene: Scene;
  viewport?: Viewport;
  ariaLabel: string;
  onPointerDown?: PointerEventHandler<HTMLCanvasElement>;
  onPointerMove?: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp?: PointerEventHandler<HTMLCanvasElement>;
  onPointerCancel?: PointerEventHandler<HTMLCanvasElement>;
  onPointerLeave?: PointerEventHandler<HTMLCanvasElement>;
  cursorLayerRef?: Ref<CursorLayerHandle>;
};

function shapeLabel(shape: Scene[number]): string {
  return `${shape.type === "rectangle" ? "Rectangle" : "Circle"} ${shape.id}`;
}

export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(
  function CanvasSurface(
    {
      scene,
      viewport = DEFAULT_VIEWPORT,
      ariaLabel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      cursorLayerRef,
    },
    ref,
  ) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const viewportRef = useRef(viewport);
  const schedulerRef = useRef<ReturnType<typeof createRenderScheduler> | null>(
    null,
  );
  const [contextAvailable, setContextAvailable] = useState(true);

  sceneRef.current = scene;
  viewportRef.current = viewport;

  useImperativeHandle(
    ref,
    () => ({
      setScene(nextScene) {
        sceneRef.current = nextScene;
        schedulerRef.current?.request();
      },
    }),
    [],
  );

  useEffect(() => {
    schedulerRef.current?.request();
  }, [scene, viewport]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!container || !canvas || !context) {
      setContextAvailable(false);
      return;
    }

    setContextAvailable(true);
    let size = { width: 0, height: 0 };
    let devicePixelRatio = 1;

    const scheduler = createRenderScheduler(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      () => {
        if (size.width === 0 || size.height === 0) return;

        context.setTransform(
          devicePixelRatio,
          0,
          0,
          devicePixelRatio,
          0,
          0,
        );
        renderScene(context, sceneRef.current, viewportRef.current, size);
      },
    );
    schedulerRef.current = scheduler;

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      size = {
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
      };
      devicePixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_DEVICE_PIXEL_RATIO,
      );

      canvas.width = Math.max(1, Math.floor(size.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(size.height * devicePixelRatio));
      scheduler.request();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      scheduler.cancel();
      schedulerRef.current = null;
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-[min(70vh,640px)] min-h-[320px] w-full max-w-5xl overflow-hidden rounded-lg border bg-white shadow-sm"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        className="block h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
      />
      <CursorLayer ref={cursorLayerRef} viewport={viewport} />
      <ul aria-label="Scene description" className="sr-only">
        {scene.map((shape) => (
          <li key={shape.id}>{shapeLabel(shape)}</li>
        ))}
      </ul>
      {!contextAvailable ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive">
          Canvas rendering is unavailable in this browser.
        </p>
      ) : null}
    </div>
    );
  },
);

CanvasSurface.displayName = "CanvasSurface";
