"use client";

import { useEffect, useRef, useState } from "react";

const TEST_DURATION_MS = 60_000;
const MIN_ACTION_DELAY_MS = 900;
const MAX_ACTION_DELAY_MS = 3_000;

type DemoAction = "cursor" | "create" | "circle" | "move" | "save";

export function formatTestTimer(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function randomDelay(minimum: number, maximum: number): number {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function canvasElement(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>(
    'canvas[aria-label^="Whiteboard canvas"]',
  );
}

function dispatchPointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
  pointerId: number,
): void {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: point.x,
      clientY: point.y,
      isPrimary: true,
      pointerId,
      pointerType: "mouse",
    }),
  );
}

function canvasPoint(canvas: HTMLCanvasElement, x: number, y: number) {
  const bounds = canvas.getBoundingClientRect();
  return { x: bounds.left + x, y: bounds.top + y };
}

async function moveCursor(
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number }>,
): Promise<void> {
  for (const point of points) {
    dispatchPointer(canvas, "pointermove", point, 9001);
    await wait(randomDelay(180, 450));
  }
}

async function runAction(action: DemoAction): Promise<string> {
  const canvas = canvasElement();
  if (!canvas) return "Canvas unavailable";

  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width));
  const height = Math.max(240, Math.floor(bounds.height));

  if (action === "cursor") {
    await moveCursor(canvas, [
      canvasPoint(canvas, randomDelay(40, width - 40), randomDelay(40, height - 40)),
      canvasPoint(canvas, randomDelay(40, width - 40), randomDelay(40, height - 40)),
      canvasPoint(canvas, randomDelay(40, width - 40), randomDelay(40, height - 40)),
    ]);
    return "Moved the cursor around the canvas";
  }

  if (action === "create" || action === "circle") {
    const shapeButton = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${action === "circle" ? "Circle" : "Rectangle"} tool"]`,
    );
    shapeButton?.click();
    await wait(randomDelay(150, 500));
    const point = canvasPoint(canvas, randomDelay(110, width - 110), randomDelay(100, height - 100));
    dispatchPointer(canvas, "pointerdown", point, 9002);
    dispatchPointer(canvas, "pointerup", point, 9002);
    return action === "circle" ? "Created a circle" : "Created a rectangle";
  }

  if (action === "move") {
    const selectButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Select tool"]',
    );
    selectButton?.click();
    await wait(randomDelay(150, 500));
    const start = canvasPoint(canvas, 140, 110);
    const end = canvasPoint(canvas, randomDelay(190, 330), randomDelay(130, 230));
    dispatchPointer(canvas, "pointerdown", start, 9003);
    await moveCursor(canvas, [end]);
    dispatchPointer(canvas, "pointerup", end, 9003);
    return "Moved a shape";
  }

  const saveButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Save board"]',
  );
  if (saveButton && !saveButton.disabled) saveButton.click();
  return "Saved the board";
}

function nextAction(index: number): DemoAction {
  const actions: DemoAction[] = ["cursor", "create", "circle", "cursor", "move", "save"];
  return actions[index % actions.length]!;
}

export function TestCanvasInteractions() {
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [recentActions, setRecentActions] = useState<string[]>([]);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);
  const deadlineRef = useRef(0);

  const stop = () => {
    runIdRef.current += 1;
    runningRef.current = false;
    setRunning(false);
    setRemaining(0);
  };

  useEffect(() => stop, []);

  const start = () => {
    if (runningRef.current) return;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    runningRef.current = true;
    deadlineRef.current = Date.now() + TEST_DURATION_MS;
    setRunning(true);
    setRemaining(TEST_DURATION_MS);
    setRecentActions(["Started randomized canvas interactions"]);

    const tick = () => {
      if (!runningRef.current || runIdRef.current !== runId) return;
      const nextRemaining = deadlineRef.current - Date.now();
      setRemaining(Math.max(0, nextRemaining));
      if (nextRemaining <= 0) {
        runningRef.current = false;
        setRunning(false);
        setRecentActions((current) => ["Finished randomized canvas interactions", ...current].slice(0, 4));
        return;
      }
      window.setTimeout(tick, 250);
    };
    window.setTimeout(tick, 250);

    void (async () => {
      let actionIndex = 0;
      while (runningRef.current && runIdRef.current === runId && Date.now() < deadlineRef.current) {
        await wait(randomDelay(MIN_ACTION_DELAY_MS, MAX_ACTION_DELAY_MS));
        if (!runningRef.current || runIdRef.current !== runId || Date.now() >= deadlineRef.current) break;
        const description = await runAction(nextAction(actionIndex));
        actionIndex += 1;
        if (runningRef.current && runIdRef.current === runId) {
          setRecentActions((current) => [description, ...current].slice(0, 4));
        }
      }
    })();
  };

  return (
    <aside aria-label="Test canvas interactions" className="mb-3 rounded-md border border-dashed bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label={running ? "Stop test canvas interactions" : "Test canvas interactions"}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          onClick={running ? stop : start}
        >
          {running ? "Stop test canvas interactions" : "Test canvas interactions"}
        </button>
        {running ? (
          <div role="timer" aria-label="Test canvas interactions timer" className="font-mono text-sm">
            {formatTestTimer(remaining)}
          </div>
        ) : null}
      </div>
      {recentActions.length > 0 ? (
        <ul aria-label="Test canvas interaction activity" className="mt-2 space-y-1 text-xs text-muted-foreground">
          {recentActions.map((action, index) => <li key={`${action}-${index}`}>{action}</li>)}
        </ul>
      ) : null}
    </aside>
  );
}
