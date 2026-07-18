"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { sceneToCanvas } from "@/features/canvas/geometry";
import type { ScenePoint, Viewport } from "@/features/canvas/model";

const CURSOR_TEST_ID = "collaborator-cursor";

export type CursorLayerHandle = {
  setCursors: (cursors: ReadonlyMap<string, ScenePoint>) => void;
  clearCursor: (clientId: string) => void;
};

function colorForClient(clientId: string): string {
  let hash = 0;
  for (const character of clientId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 75% 42%)`;
}

export const CursorLayer = forwardRef<CursorLayerHandle, { viewport: Viewport }>(
  function CursorLayer({ viewport }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const cursorsRef = useRef(new Map<string, ScenePoint>());
    const nodesRef = useRef(new Map<string, HTMLDivElement>());
    const frameRef = useRef<number | null>(null);
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    useImperativeHandle(ref, () => {
      const render = () => {
        frameRef.current = null;
        for (const [clientId, point] of cursorsRef.current) {
          const node = nodesRef.current.get(clientId);
          if (!node) continue;
          const canvasPoint = sceneToCanvas(point, viewportRef.current);
          node.style.left = `${canvasPoint.x}px`;
          node.style.top = `${canvasPoint.y}px`;
        }
      };
      const scheduleRender = () => {
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(render);
      };
      const removeNode = (clientId: string) => {
        nodesRef.current.get(clientId)?.remove();
        nodesRef.current.delete(clientId);
      };
      const ensureNode = (clientId: string) => {
        const existing = nodesRef.current.get(clientId);
        if (existing) return existing;
        const node = document.createElement("div");
        node.dataset.testid = CURSOR_TEST_ID;
        node.dataset.clientId = clientId;
        node.setAttribute("aria-hidden", "true");
        node.className = "absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md";
        node.style.backgroundColor = colorForClient(clientId);
        rootRef.current?.appendChild(node);
        nodesRef.current.set(clientId, node);
        return node;
      };

      return {
        setCursors(nextCursors: ReadonlyMap<string, ScenePoint>) {
          cursorsRef.current = new Map(nextCursors);
          for (const clientId of nodesRef.current.keys()) {
            if (!cursorsRef.current.has(clientId)) removeNode(clientId);
          }
          for (const clientId of cursorsRef.current.keys()) ensureNode(clientId);
          scheduleRender();
        },
        clearCursor(clientId: string) {
          cursorsRef.current.delete(clientId);
          removeNode(clientId);
          scheduleRender();
        },
      };
    }, []);

    useEffect(() => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      for (const node of nodesRef.current.values()) node.remove();
      nodesRef.current.clear();
    }, []);

    return <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />;
  },
);

CursorLayer.displayName = "CursorLayer";
