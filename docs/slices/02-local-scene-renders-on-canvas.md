# Slice 2 — Local Scene Renders on a Canvas

## What To Study

1. [MDN: CanvasRenderingContext2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D) — read the 2D context, rectangle drawing, clearing, and transform APIs. This informs the native Canvas renderer and its reset-before-draw behavior.
2. [MDN: `requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — read the one-shot repaint scheduling behavior. This informs an invalidation-driven render scheduler instead of an always-running loop.
3. [MDN: `Window.devicePixelRatio`](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) — read the high-DPI canvas sizing example. This informs CSS-pixel scene coordinates and backing-store scaling.
4. [MDN: `ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) — read element-size observation and teardown. This informs responsive canvas sizing without coupling the renderer to window dimensions.
5. [MDN: Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) and [`setPointerCapture()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) — read for the next interaction slice. This preserves the pointer boundary without implementing drag behavior here.

## Goal

An unauthenticated visitor opens the whiteboard route and sees a responsive
canvas containing one rectangle and one circle from a deterministic local
scene. The shapes must render sharply in CSS coordinates, remain visible after
the canvas container resizes, and not require a database, network request, or
WebSocket connection.

The stable outcome is the renderer contract:

```text
Scene[] -> renderScene(CanvasRenderingContext2D, Scene, Viewport)
```

The scene source is disposable local data. Later slices may replace it with
local interaction state, WebSocket updates, or a CRDT without changing the
renderer’s input contract.

## Non-goals

- No persistence, tRPC query, ZenStack model, or PostgreSQL access.
- No WebSocket, Redis, Yjs, authentication, or authorization.
- No shape creation, selection, hit testing, dragging, pointer capture, or
  multi-touch behavior; those belong to slice 3.
- No zoom, pan, rotation, text, lines, images, resize handles, undo/redo, or
  scene serialization.
- No continuous animation loop. A frame is scheduled only when the scene or
  canvas dimensions change.

## Design

### Core mental model

```text
deterministic local scene
    -> Whiteboard page supplies scene props
    -> CanvasSurface owns the browser canvas lifecycle
    -> ResizeObserver measures CSS layout size
    -> DPR-aware backing store is configured
    -> requestAnimationFrame schedules one render
    -> renderScene clears and draws every shape
    -> accessible canvas label/fallback describes the visible scene
```

The App Router page remains a server component and supplies deterministic data.
The canvas surface is a client component because it needs `canvas`,
`ResizeObserver`, `requestAnimationFrame`, and browser effects. The client
component must not fetch data or know about future transport/persistence.

### Scene model

Use a discriminated union with immutable value objects:

```ts
type ScenePoint = { x: number; y: number };

type RectangleShape = {
  id: string;
  type: "rectangle";
  position: ScenePoint;
  width: number;
  height: number;
  fill: string;
};

type CircleShape = {
  id: string;
  type: "circle";
  center: ScenePoint;
  radius: number;
  fill: string;
};

type Shape = RectangleShape | CircleShape;
type Scene = readonly Shape[];
```

The model uses scene-space CSS pixels. It does not contain DOM nodes,
`CanvasRenderingContext2D`, React state setters, database records, or transport
metadata.

### Rendering and viewport

Keep coordinate conversion pure and identity-based for this slice so later zoom
and pan can be added without changing the renderer signature:

```ts
type Viewport = {
  origin: ScenePoint;
  zoom: number;
};

function sceneToCanvas(point: ScenePoint, viewport: Viewport): ScenePoint {
  return {
    x: (point.x - viewport.origin.x) * viewport.zoom,
    y: (point.y - viewport.origin.y) * viewport.zoom,
  };
}
```

The renderer must:

1. Clear the logical drawing area.
2. Set the fill style for each shape.
3. Draw rectangles with `fillRect`.
4. Draw circles with `beginPath`, `arc`, and `fill`.
5. Avoid reading React state or browser layout during drawing.

The canvas element’s CSS size is controlled by layout. Its bitmap size is set
to the measured CSS size multiplied by `window.devicePixelRatio`, while the
context transform is normalized so scene coordinates remain CSS pixels. Clamp
the effective ratio to a safe implementation maximum such as `2` to avoid
unbounded backing-store memory on extreme displays.

### Canvas lifecycle

`CanvasSurface` owns only imperative resources:

- canvas and 2D context refs;
- the current measured CSS width/height;
- the current DPR-adjusted backing-store dimensions;
- one pending animation-frame ID;
- one `ResizeObserver` instance.

On mount, create the observer and schedule a render. On scene or viewport
changes, update the render input and schedule one frame. On resize, update the
backing store and schedule one frame. On unmount, cancel the pending frame and
disconnect the observer. No event listener or observer may survive component
unmount.

### Accessibility and layout

Canvas pixels are not sufficient as the only user-visible semantic. Render:

- a `<canvas role="img" aria-label="Whiteboard canvas with 2 shapes">`;
- a visually hidden fallback list naming the rectangle and circle;
- a bounded, responsive canvas container with `touch-action: none` reserved
  for the upcoming pointer slice.

The fallback is descriptive only in this slice; it is not an alternate editing
surface.

### Repository and feature ownership

```text
apps/web/src/
├── app/
│   └── page.tsx                         # Supplies deterministic mock scene
├── features/canvas/
│   ├── model.ts                         # Scene and Shape types
│   ├── geometry.ts                      # Pure coordinate conversion helpers
│   ├── renderer.ts                      # Pure CanvasRenderingContext2D drawing
│   ├── canvas-surface.tsx               # Client lifecycle and frame scheduling
│   └── canvas.test.ts                    # Model, geometry, and render tests
└── styles/globals.css                   # Canvas container/layout tokens
```

Do not add a database model, tRPC router, Zustand store, or shared transport
contract for this local-only slice. The local scene is intentionally a
feature-owned fixture until slice 3 proves the interaction state boundary.

## Interfaces

### Public feature contracts

```ts
export type CanvasSurfaceProps = {
  scene: Scene;
  viewport?: Viewport;
  ariaLabel: string;
};

export function renderScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  viewport: Viewport,
  size: { width: number; height: number },
): void;

export function scheduleRender(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (id: number) => void,
  render: () => void,
): { request: () => void; cancel: () => void };
```

`renderScene` is the stable boundary future slices must preserve. `CanvasSurface`
may change its state source and scheduling internals, but callers continue to
provide a scene and viewport.

### Invariants

- Shape IDs are unique within one scene.
- Dimensions and radius are finite and greater than zero.
- Fill values are trusted local presentation values in this slice; untrusted
  network values will require Zod validation at the later transport boundary.
- Rendering is deterministic for the same scene, viewport, and canvas size.
- The renderer never mutates the supplied scene.
- The server is not involved, so there is no authorization or mutation error
  path in this slice.

## Execution flow

### Normal path

```text
App Router page
    -> creates deterministic Scene with rectangle + circle
    -> renders CanvasSurface client boundary
    -> CanvasSurface obtains 2D context
    -> ResizeObserver reports container CSS size
    -> configure backing store using CSS size and capped DPR
    -> schedule one requestAnimationFrame
    -> renderScene clears and draws the scene
    -> browser paints canvas and accessible fallback
```

### State transitions

```text
unmounted
  -> mounted (create context and observer)
  -> measured (configure canvas backing store)
  -> render-scheduled (one pending frame)
  -> rendered (clear and draw scene)
  -> resized (replace backing store and schedule one frame)
  -> unmounted (cancel frame and disconnect observer)
```

### Error path

If `getContext("2d")` returns `null`, render a visible fallback message such as
“Canvas rendering is unavailable in this browser.” Do not throw during render,
do not claim the shapes are visible, and keep the accessible scene description
available. A later slice may add a non-canvas renderer if product requirements
need it.

## Failure cases

| Failure | User-visible behavior | Recovery / invariant |
|---|---|---|
| 2D context unavailable | Fallback message is shown; scene description remains available | No crash; renderer is not invoked with a missing context |
| Container has zero size during first measurement | Canvas remains empty but mounted | A later non-zero ResizeObserver measurement schedules a render |
| Resize occurs repeatedly | Latest dimensions win; at most one frame is pending | Observer and frame scheduler remain bounded |
| Device pixel ratio changes | Next resize/DPR observation reconfigures the backing store and redraws | Scene coordinates remain in CSS pixels |
| Invalid local fixture | Unit test fails before rendering | Keep model fixture finite and positive; external validation belongs later |
| Component unmounts with frame pending | No render occurs after unmount | `cancelAnimationFrame` and observer disconnect are mandatory |
| Render exception | Error boundary/fallback handles the failure without a false success state | Keep drawing helpers pure and test shape branches independently |

## Tests

### Unit tests — Vitest

| Scenario | Level | Expected observable behavior |
|---|---|---|
| Scene type accepts rectangle and circle branches | Unit/typecheck | Discriminated union narrows each renderer branch without casts in feature code |
| Coordinate conversion with identity viewport | Unit | Scene point remains unchanged; future zoom/origin math has a focused seam |
| Coordinate conversion with non-default viewport | Unit | Point is translated and scaled according to the viewport |
| Rectangle rendering | Unit | Mock context receives clear, fill-style, and `fillRect` calls with expected values |
| Circle rendering | Unit | Mock context receives `beginPath`, `arc`, and `fill` calls with expected values |
| Empty scene | Unit | Canvas is cleared and no shape draw calls occur |
| Render scheduler coalesces invalidations | Unit | Multiple requests before a frame produce one callback; cancel prevents the callback |
| Resize cleanup | Component/integration | Observer disconnects and pending frame is cancelled on unmount |

### Browser test — Playwright

Add a focused test to `tests/e2e/whiteboard.spec.ts`:

1. Open `/`.
2. Locate the canvas by its accessible role and label.
3. Assert the accessible fallback names the rectangle and circle.
4. Assert the canvas has non-zero rendered dimensions.
5. Capture a canvas screenshot or inspect a stable rendered-pixel signal to
   verify the canvas is not blank.
6. Resize the viewport and assert the canvas remains present with non-zero
   dimensions.

Use accessible selectors for the public outcome. Do not inspect React state,
the renderer’s private refs, or an implementation-specific store.

### Verification commands

```sh
bun run test:unit
bun run test:e2e -- tests/e2e/whiteboard.spec.ts
bun run typecheck
bun run lint
bun run build
```

No database or Docker service should be required for this slice.

## Definition of done

- The whiteboard route visibly renders one rectangle and one circle on a Canvas
  2D surface from deterministic local scene data.
- The renderer accepts the documented `Scene` and `Viewport` contracts and is
  independent of React, tRPC, ZenStack, WebSockets, and persistence.
- Canvas backing-store sizing accounts for CSS size and a capped DPR.
- Resizing redraws the same scene without distortion or stale dimensions.
- Loading is not applicable to local fixture data; empty scene, successful
  render, unavailable-context, and unmount cleanup behavior are covered.
- Canvas accessibility includes a role/label and a descriptive fallback.
- Unit tests cover geometry, both shape branches, empty scenes, scheduling,
  and cleanup.
- Playwright verifies the visible canvas and survives a viewport resize.
- `bun run test:unit`, the focused E2E test, typecheck, lint, and build pass.
- Slice 2 is marked `[x]` in `docs/01.implementation-slices.md` only after
  all criteria pass.

## Future improvements

- Slice 3 adds pointer capture, hit testing, rectangle creation, and dragging;
  preserve `Scene`, `Viewport`, `renderScene`, and the coordinate conversion
  boundary.
- Slice 4 replaces the local scene source with validated realtime operations;
  preserve renderer determinism and keep transport parsing outside the canvas.
- Slice 6 may replace the scene array with Yjs-backed state; preserve the same
  render input contract and browser-visible shape behavior.
- Add viewport transforms, zoom/pan, more shape types, text, selection, and
  accessibility affordances only when their corresponding slices begin.
- Consider OffscreenCanvas only after profiling demonstrates main-thread render
  pressure; do not introduce it as an unverified dependency in this slice.
