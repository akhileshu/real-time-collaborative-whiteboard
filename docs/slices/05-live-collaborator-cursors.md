# Slice 5: Live collaborator cursors

## What To Study

| Reference | Decision informed |
|---|---|
| [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | Use `pointermove`, `pointerleave`, and `pointercancel`; keep pointer handlers lightweight. |
| [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | Coalesce render work to the browser’s paint cycle. |
| [Bun WebSocket backpressure](https://bun.sh/docs/runtime/http/websockets) | Interpret server `send()` status and avoid building an unbounded cursor queue. |
| [Elysia WebSocket](https://elysiajs.com/patterns/websocket) | Preserve the existing Elysia `.ws()` lifecycle and shared message validation. |

## Goal

Enable two connected clients in the same room to see each other’s current pointer
position over the whiteboard. Cursor data is ephemeral presence: it is validated,
rate-limited, rendered independently of the document scene, and removed when the
pointer leaves or the connection closes.

## Non-goals

- Do not persist cursors, add cursor history, or include cursors in scene operations.
- Do not change the document revision, scene snapshot, or operation deduplication.
- Do not add names, avatars, authentication, permissions, Redis, or multi-node fan-out.
- Do not introduce a new HTTP endpoint, server action, tRPC procedure, CRDT, or database model.
- Do not put every pointer sample or remote cursor coordinate in React state or Zustand.

## Design

### Ownership and boundaries

The existing room connection remains the client transport. The realtime process
owns room membership and ephemeral cursor presence, but the existing in-memory
document room remains the authority for shapes and revisions. A separate
`PresenceRegistry` is preferred over adding cursor fields to `RoomRegistry`, so
the document lifecycle cannot accidentally persist or replay presence.

Likely ownership:

| Concern | Location | Responsibility |
|---|---|---|
| Cursor Zod schemas and inferred types | `packages/contracts/src/document-operations.ts` or a nearby `presence.ts` | Validate client and server cursor messages. |
| Ephemeral room cursor map | `apps/realtime/src/rooms/presence-registry.ts` | Store latest cursor per room/member; remove on leave. |
| WebSocket routing | `apps/realtime/src/transport/websocket-route.ts` | Authenticate the joined connection’s identity, route cursor messages, and broadcast removal. |
| Socket lifecycle | `apps/web/src/features/collaboration/room-connection.ts` | Send coalesced local samples and expose typed cursor events. |
| Pointer sampling | `apps/web/src/features/canvas/interactive-canvas.tsx` | Convert client coordinates to scene coordinates and report samples. |
| Render-only overlay | `apps/web/src/features/collaboration/cursor-layer.tsx` | Imperatively update cursor markers without scene or React render churn. |

### Coordinate and identity contract

Cursor positions use the same bounded scene coordinate space as shape geometry.
The client converts `PointerEvent.clientX/clientY` through the existing canvas
coordinate helper before sending. The client sends no participant ID; the server
uses the client ID recorded during `join` when constructing outbound messages.

The first implementation supports one cursor per joined connection. A cursor is
visible only while the pointer is over the canvas. A deterministic color derived
from the stable participant ID differentiates cursors locally; color is not part
of the wire protocol.

### Rate limiting and rendering

- Keep only the latest local sample while the socket is not ready or the send interval is active.
- Send at most one cursor update every 50 ms per client (20 updates/second).
- Do not queue stale samples. Count samples skipped by the throttle and samples dropped by socket/backpressure conditions.
- Use `requestAnimationFrame` to batch overlay updates. Remote messages update a mutable `Map<clientId, CursorPoint>`; the overlay writes marker positions imperatively.
- The overlay is `pointer-events: none` and does not participate in document hit testing.
- Keep an accessible low-frequency presence summary for join/leave and count; the animated cursor layer itself may be `aria-hidden="true"`.

### Contract shape

Extend the shared discriminated unions with the smallest presence protocol:

```ts
const cursorPointSchema = scenePointSchema;

const cursorMessageSchema = z.object({
  type: z.literal("cursor"),
  point: cursorPointSchema.nullable(),
});

const presenceStateSchema = z.object({
  type: z.literal("presence-state"),
  cursors: z.array(z.object({
    clientId: clientIdSchema,
    point: cursorPointSchema,
  })),
});

const cursorSchema = z.object({
  type: z.literal("cursor"),
  clientId: clientIdSchema,
  point: cursorPointSchema,
});

const cursorHiddenSchema = z.object({
  type: z.literal("cursor-hidden"),
  clientId: clientIdSchema,
});
```

The client union accepts only `{ type: "cursor", point }`. The server union
contains `presence-state`, `cursor`, and `cursor-hidden`. `null` means “hide my
cursor”; it is not stored as a coordinate. The server must reject cursor input
from a client that has not completed `join`, and must never trust a client-supplied
outbound `clientId`.

### Presence registry invariants

- A cursor entry exists only for a current room member.
- `putCursor` replaces the previous point for that member and never changes the document revision.
- `removeCursor` is idempotent and emits at most one hide event for the transition.
- Joining receives a snapshot of currently visible cursors, excluding the joining client.
- Leaving removes the cursor before broadcasting `cursor-hidden` and leaves no empty room presence state behind.
- Presence is process-local and disappears on realtime-process restart.

## Interfaces

The design should preserve the existing connection API and add narrow cursor
events rather than exposing the raw socket to canvas code:

```ts
type CursorPoint = ScenePoint;

type RoomConnectionEvents = ExistingRoomConnectionEvents & {
  onPresenceState: (message: Extract<ServerMessage, { type: "presence-state" }>) => void;
  onCursor: (message: Extract<ServerMessage, { type: "cursor" }>) => void;
  onCursorHidden: (message: Extract<ServerMessage, { type: "cursor-hidden" }>) => void;
};

type RoomConnection = {
  connect: () => void;
  sendOperation: (operation: SceneOperation, revision: number) => boolean;
  sendCursor: (point: CursorPoint | null) => boolean;
  close: () => void;
};
```

The exact type names may follow the repository’s existing exports, but these
invariants must remain: cursor messages are shared Zod data, client transport
owns throttling, and canvas code does not know about WebSocket serialization.

The overlay should expose an imperative handle similar to the existing canvas
surface handle:

```ts
type CursorLayerHandle = {
  setCursors: (cursors: ReadonlyMap<string, CursorPoint>) => void;
  clearCursor: (clientId: string) => void;
};
```

`CollaborativeWhiteboard` owns the connection and a cursor map ref. It forwards
remote cursor events to the layer and keeps only low-frequency status/count in
React state. The local pointer path reports a scene point to the connection on
move, sends `null` on leave/cancel, and continues to use the existing operation
path for shape creation and dragging.

## Execution flow

1. The whiteboard creates the existing room connection and initializes an empty local cursor map.
2. After `join` succeeds, the server sends `room-state` and `presence-state`; the client renders the existing remote cursors.
3. A pointer move over the canvas is converted to a bounded scene point. The connection’s latest-sample coalescer sends it only if 50 ms have elapsed and the socket is open.
4. The realtime route validates the message, verifies the joined connection, stores the latest point in `PresenceRegistry`, and broadcasts a server-authored `cursor` message to other room members.
5. A receiving client validates the message, updates its cursor map ref, and schedules one overlay redraw with `requestAnimationFrame`.
6. `pointerleave` or `pointercancel` removes the local marker and sends `{ type: "cursor", point: null }`; the server removes the entry and broadcasts `cursor-hidden`.
7. WebSocket close performs the same removal path server-side, so peers remove the disconnected cursor even if the client could not send its final hide message.

## Failure cases

- Malformed, non-finite, or out-of-bounds points: reject with the existing protocol-error path; do not mutate presence.
- Cursor before join or after leave: ignore/reject as a protocol error without touching the document room.
- Duplicate or delayed cursor samples: latest valid point wins; no ordering or replay guarantee is required.
- Socket not open: retain only the latest local sample and drop it if the connection closes; never block pointer handling.
- Server send returns backpressure or zero bytes: drop that ephemeral broadcast, increment a metric, and allow the next sample to supersede it.
- Remote hide for an unknown client: treat as idempotent and do not create state.
- Room membership changes during a broadcast: use the existing direct member fan-out adapter and tolerate a closed recipient.
- Canvas resize: preserve scene coordinates and recompute marker screen positions during the next overlay frame.
- Realtime restart: all cursors disappear with the process; reconnecting clients rebuild presence from the new room snapshot.

## Tests

### Unit tests

- Shared schemas accept valid cursor messages and reject wrong identity, non-finite, oversized, and malformed points.
- The local coalescer sends no more than 20 updates/second, keeps the latest sample, sends hide once, and stops after cleanup.
- `PresenceRegistry` covers put, replace, hide, idempotent remove, room isolation, and cleanup.
- Applying cursor messages never changes a scene, operation ID set, or document revision.
- Cursor-layer coordinate conversion and deterministic color are stable across resize and repeated client IDs.
- Connection tests cover presence snapshot, cursor, hide, protocol errors, closed sockets, and send failures.

### Playwright behavior

Use two isolated browser contexts and a unique room ID:

1. Join the room in both contexts and verify both are connected.
2. Move the pointer inside client A’s canvas; assert client B exposes a visible cursor marker for A and that its position changes after another move.
3. Create/drag a shape while the cursor is active and verify cursor updates do not alter the document operation behavior.
4. Close client A; assert client B removes A’s marker and retains its own canvas/scene.
5. Assert the realtime process remains responsive after repeated rapid pointer movement and that no unbounded cursor DOM nodes are created.

The browser assertion should use an accessible presence status for connection
state and a stable `data-client-id` on the render-only marker for position and
removal checks; it must not depend on a particular canvas pixel or color value.

## Definition of done

- [x] Shared Zod contracts define client cursor, presence snapshot, cursor update, and cursor removal messages.
- [x] The server derives sender identity from the joined connection, validates points, and stores presence separately from document state.
- [x] Pointer movement is converted to scene coordinates, throttled to at most 20 updates/second, and coalesced latest-wins.
- [x] Remote cursors render in an imperative, pointer-transparent overlay without per-sample React/Zustand state updates.
- [x] Pointer leave/cancel and connection close remove cursors for peers.
- [x] Unit tests cover contracts, throttling, registry invariants, and connection lifecycle.
- [x] The two-client Playwright workflow verifies movement and disconnect removal.
- [x] `bun run test:unit`, `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run test:e2e` pass serially.
- [x] Metrics or structured counters expose throttled local samples, dropped sends, invalid messages, and active cursors.

## Future improvements

- Add authenticated display names and stable user colors from server-backed identity.
- Move presence fan-out behind Redis or another broker only after horizontal realtime scaling is required.
- Add interpolation or short-lived fade-out for smoother remote motion if measurements show a need.
- Add touch/pen-specific cursor semantics and multi-pointer support.
- Keep cursor traffic on a separate protocol path if CRDT/document updates later require stricter ordering or prioritization.
