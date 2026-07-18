# Slice 3 — User Creates and Drags a Shape Locally

## What To Study

1. [MDN: Using Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events) — read the canvas pointer-event flow and device-agnostic input model. This informs one shared mouse, pen, and touch interaction path.
2. [MDN: Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) — read pointer capture, event targeting, and handler best practices. This informs the single active-pointer lifecycle and event-handler ownership.
3. [MDN: `setPointerCapture()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) — read capture and release behavior. This informs dragging outside the original shape/canvas hit area.
4. [MDN: `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) — read `touch-action: none` and `pointercancel`. This informs touch behavior on the canvas without disabling page zoom globally.
5. [MDN: `clientX`](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/clientX) — read viewport-relative pointer coordinates. This informs conversion from browser coordinates to scene CSS pixels using the canvas bounding rect and viewport.

## Goal

An unauthenticated visitor opens `/whiteboard`, chooses the Rectangle tool,
and presses the canvas to create one rectangle. The visitor can then drag that
rectangle with a mouse, pen, or primary touch pointer. The rectangle follows
the pointer during the gesture and its final position remains visible after
pointer release.

The slice proves the local interaction boundary:

```text
PointerEvent -> scene-space sample -> hit/create operation -> mutable draft scene
             -> CanvasSurface imperative redraw -> committed local scene/status
```

The renderer from slice 2 remains unchanged as a pure consumer of `Scene` and
`Viewport` values.

## Non-goals

- No tRPC, ZenStack, PostgreSQL, WebSocket, Redis, Yjs, persistence, or auth.
- No multi-pointer gestures, pinch zoom, pan, rotation, or viewport zoom.
- No resize handles, shape deletion, text/line tools, undo/redo, or selection
  marquee.
- No optimistic network mutation or server conflict resolution.
- No keyboard-based shape manipulation in this slice; the tool controls and
  live position status remain keyboard accessible, while keyboard editing is a
  later accessibility slice.
- Do not add a new state-management dependency. Use React state for committed
  low-frequency UI state and refs for the active pointer/draft path.

## Design

### Core mental model

```text
tool button or pointer event
    -> CanvasSurface event boundary
    -> client coordinates converted to scene coordinates
    -> pure hit-test/create/move operation
    -> mutable draft scene ref
    -> CanvasSurface.setScene() schedules one redraw
    -> pointerup commits the final scene to React state
    -> accessible status reports selected/final position
```

There is no database truth or server endpoint in this local slice. The local
committed scene is the source of truth until the realtime slice replaces it.
The server remains uninvolved rather than being simulated by a client policy.

### State ownership

Use three distinct state classes:

- `scene`: React state containing the last committed local scene. It updates on
  create, pointer release, and pointer cancellation—not on every pointer move.
- `draftSceneRef`: mutable ref containing the scene currently being rendered
  during a drag. It is passed to `CanvasSurfaceHandle.setScene()` for direct
  redraw without React renders.
- `activePointerRef`: mutable ref containing exactly zero or one active drag.
  It stores `pointerId`, `shapeId`, `grabOffset`, and the original committed
  scene needed for cancellation rollback.

Tool selection and the selected shape ID are ordinary low-frequency React UI
state. They must not be used as the high-frequency pointer loop.

### Interaction policy

Provide two tools:

- `Select`: pointer down on a shape selects it and begins dragging; pointer
  down on empty space does nothing.
- `Rectangle`: pointer down on empty space creates a fixed `120 x 80` rectangle
  centered under the pointer, selects it, and begins dragging. After pointerup,
  return to `Select`.

Hit testing checks shapes in reverse scene order so the visually topmost shape
wins. Rectangle containment uses its axis-aligned bounds. Circle containment
uses squared distance to its center. The operation returns a shape ID and grab
offset, not a DOM element or canvas context.

Only the primary button/primary pointer starts a gesture. Additional pointers
are ignored while one pointer is active. `pointercancel` rolls back the draft
to the pre-gesture committed scene and clears the active pointer.

### Pointer lifecycle and cleanup

`CanvasSurface` continues to own the canvas element and rendering resources. It
will be extended with optional pointer handlers and a small imperative handle:

```text
CanvasSurfaceHandle.setScene(scene)
CanvasSurface onPointerDown/onPointerMove/onPointerUp/onPointerCancel
```

The surface forwards React pointer events to the feature controller. The
controller calls `event.currentTarget.setPointerCapture(pointerId)` after a
gesture starts, and releases capture on `pointerup` or `pointercancel` when
the canvas still owns it. No document/window listeners are needed.

The canvas keeps `touch-action: none`; this is limited to the interaction
surface rather than the page/body so browser page zoom remains available.
The controller clears refs on both pointer termination and component unmount.

### Repository and feature ownership

```text
apps/web/src/
├── app/whiteboard/page.tsx                   # Route composition
└── features/canvas/
    ├── model.ts                              # Existing Scene/Shape contracts
    ├── geometry.ts                           # Existing viewport conversion
    ├── renderer.ts                           # Existing pure renderer
    ├── canvas-surface.tsx                    # Canvas lifecycle + event boundary
    ├── interaction.ts                        # Hit testing, create, move, points
    ├── interaction.test.ts                   # Pure interaction invariants
    └── interactive-canvas.tsx                # Local scene controller and toolbar
```

Do not move the scene model into a database, tRPC router, shared contracts
package, or realtime process. Do not put coordinate arithmetic in the route or
the raw Canvas context methods in the interaction domain helpers.

## Interfaces

### Scene and interaction contracts

Reuse `Scene`, `Shape`, `ScenePoint`, `Viewport`, and `renderScene` from slice 2.
Add pure contracts like these:

```ts
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

export type CanvasSurfaceHandle = {
  setScene: (scene: Scene) => void;
};

export type CanvasTool = "select" | "rectangle";

export function clientToScenePoint(
  sample: Pick<PointerSample, "clientX" | "clientY">,
  bounds: DOMRect,
  viewport: Viewport,
): ScenePoint;

export function hitTest(scene: Scene, point: ScenePoint): string | null;

export function createRectangle(
  scene: Scene,
  center: ScenePoint,
  id: string,
): { scene: Scene; shapeId: string };

export function moveShape(
  scene: Scene,
  shapeId: string,
  position: ScenePoint,
  grabOffset: ScenePoint,
): Scene;
```

`clientToScenePoint`, `hitTest`, `createRectangle`, and `moveShape` are pure
and unit-testable. The browser event adapter owns `PointerEvent` and `DOMRect`;
the domain helpers receive normalized values. The client owns presentation
state, but the renderer remains the only code that touches the canvas context.

### Input and authority

Pointer coordinates are browser input, but they do not cross a server trust
boundary in this slice. Normalize them at the CanvasSurface/controller edge,
reject non-primary or non-finite samples, then pass `ScenePoint` into pure
helpers. Future network operations must add Zod validation in the transport
boundary before entering these helpers.

Authorization is not applicable because all state is local and unauthenticated.
The future realtime server will become authoritative for accepted operations;
this slice must not grow client-side permission logic.

### Observable UI contract

The interactive page exposes:

- button `Rectangle tool`, with pressed state;
- button `Select tool`, with pressed state;
- the existing canvas accessible label;
- a polite live status such as `Created rectangle at x 120, y 80` or
  `Moved rectangle-1 to x 180, y 120`;
- the existing scene description, updated after a committed change.

The status is feedback, not a second source of scene truth.

## Execution flow

### Create flow

```text
idle/select
  -> user activates Rectangle tool
  -> pointerdown on empty canvas
  -> convert client point to scene point
  -> create fixed-size rectangle with unique local ID
  -> store active pointer + original scene in refs
  -> setPointerCapture(pointerId)
  -> set draft scene through CanvasSurface handle
  -> pointerup
  -> release capture
  -> commit draft scene to React state
  -> switch to Select and announce created position
```

### Drag flow

```text
idle/select
  -> pointerdown on topmost hit shape
  -> store pointer ID, shape ID, grab offset, original scene
  -> setPointerCapture(pointerId)
  -> pointermove for the active pointer
  -> convert client point and move only the active shape in draft ref
  -> CanvasSurface.setScene(draft) schedules one redraw
  -> pointerup
  -> release capture and commit final scene
  -> announce final position
```

Pointer move must not call React `setState`, invalidate a query, or write to a
server. The render scheduler already coalesces redraws so high-frequency input
does not create an unbounded frame queue.

### State transitions

```text
idle
  -> tool-selected (select or rectangle)
  -> pointer-active (one pointer captured, draft exists)
  -> dragging (draft redraws on pointermove)
  -> committed (pointerup, React scene updated, status announced)
  -> cancelled (pointercancel/unmount, original scene restored)
```

### Recovery paths

```text
invalid pointer sample
  -> ignore event
  -> preserve active draft and allow later valid move

pointercancel
  -> release capture when available
  -> restore original scene through CanvasSurface handle
  -> clear refs and announce cancellation

unmount during drag
  -> clear refs and cancel CanvasSurface resources
  -> do not commit a partial draft
```

## Failure cases

| Failure | User-visible behavior | Recovery / invariant |
|---|---|---|
| Pointer is not primary or another pointer is active | Event is ignored; current gesture is unchanged | At most one active pointer exists |
| Pointer down misses every shape in Select mode | No selection or scene change | No accidental creation in Select mode |
| Pointer sample is outside the canvas | Captured drag continues and shape follows scene coordinates | `clientX/clientY` are converted using the current bounding rect |
| Pointer leaves the canvas during drag | Drag continues until release/cancel | Pointer capture remains active |
| `pointercancel` fires | Draft returns to the pre-gesture scene | Capture/ref state is released and cleared |
| Shape ID is missing during move | No mutation is committed; status reports an interaction error only if actionable | Pure operation returns unchanged scene or a classified result |
| Rectangle tool receives invalid coordinates | Rectangle is not created | Reject non-finite values before domain mutation |
| Component unmounts during drag | No partial draft is committed | Clear active refs and release/cancel owned resources |
| Touch browser starts native scrolling/zooming | Canvas receives cancellation according to browser behavior | `touch-action: none` is scoped to canvas; page zoom remains available |

## Tests

### Unit tests — Vitest

| Scenario | Level | Expected observable behavior |
|---|---|---|
| Client point conversion at identity viewport | Unit | `client - rect.left/top` becomes the scene point |
| Client point conversion with viewport offset/zoom | Unit | Translation and scaling match the existing geometry contract |
| Rectangle hit test | Unit | Point inside bounds returns the rectangle ID; edge outside misses |
| Circle hit test | Unit | Point inside radius returns the circle ID; outside misses |
| Topmost hit wins | Unit | Reverse scene order selects the visually topmost overlapping shape |
| Create rectangle | Unit | Fixed-size rectangle is added with requested ID and centered at the pointer |
| Move rectangle | Unit | Only the target rectangle changes and grab offset is preserved |
| Move circle | Unit | Only the target circle center changes |
| Invalid/missing target | Unit | Operation returns unchanged scene and no impossible shape state |
| Pointer controller cancellation | Unit/integration | Cancel restores the original scene and clears active pointer state |

### Browser test — Playwright

Add a focused test to `tests/e2e/whiteboard.spec.ts` or split a dedicated
`tests/e2e/whiteboard-interaction.spec.ts` if the existing canvas test becomes
too broad:

1. Open `/whiteboard` and assert the initial rectangle/circle scene is visible.
2. Activate `Rectangle tool` using its accessible button.
3. Pointer down on an empty canvas location and release; assert the accessible
   scene description/status reports a third rectangle.
4. Activate `Select tool` and drag the created rectangle from its center to a
   new location using Playwright mouse/pointer actions.
5. Assert the public status reports the new position and the rectangle remains
   in the scene after pointer release.
6. Start another drag, move outside the canvas, release, and assert the drag
   completes rather than losing the pointer.
7. Run the test at a touch-capable context or dispatch a cancellation path if
   the browser harness cannot produce a real touch cancellation.

Keep assertions on accessible controls, scene description, status, and final
observable position. Do not inspect refs, React state, or the Canvas 2D call
sequence in Playwright.

### Verification commands

```sh
bun run test:unit
bun run test:e2e -- tests/e2e/whiteboard.spec.ts
bun run typecheck
bun run lint
bun run build
```

No database, Docker, tRPC request, or realtime process is required for this
slice.

## Definition of done

- `/whiteboard` exposes accessible Select and Rectangle tools.
- Rectangle mode creates one fixed-size rectangle at the pointer location.
- Select mode hit-tests and drags the topmost rectangle or circle.
- Dragging uses pointer capture and works after the pointer leaves the canvas.
- Pointer moves update the draft scene without React state updates or network
  calls; redraws remain coalesced by the existing scheduler.
- `pointerup` commits the final local scene and `pointercancel` restores the
  original scene.
- Invalid, duplicate, and secondary pointer inputs cannot corrupt the scene.
- Live status and scene description provide observable feedback after create,
  commit, and cancellation.
- Unit tests cover coordinate conversion, hit testing, create/move operations,
  topmost selection, and cancellation.
- Playwright covers create, drag, release outside the canvas, and visible final
  position feedback.
- `bun run test:unit`, focused Playwright tests, typecheck, lint, and build pass.
- Slice 3 is marked `[x]` in `docs/01.implementation-slices.md` only after all
  criteria pass.

## Future improvements

- Slice 4 converts local scene changes into validated room operations while
  preserving `Scene`, `renderScene`, hit-test semantics, and visible drag
  outcomes.
- Slice 5 adds ephemeral collaborator cursors without putting cursor samples
  into the durable scene.
- Slice 6 replaces the local committed scene with a convergent shared document;
  preserve pointer capture and the render/input boundaries.
- Add keyboard shape movement and richer accessible editing semantics before
  treating canvas interaction as a complete accessibility surface.
- Add undo/redo, deletion, resize handles, drag snapping, and multi-touch only
  in their own slices.
