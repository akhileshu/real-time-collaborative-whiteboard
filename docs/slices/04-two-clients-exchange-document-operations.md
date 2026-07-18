# Slice 4 — Two Clients Join a Room and Exchange Document Operations

## What To Study

1. [Elysia WebSocket patterns](https://elysiajs.com/patterns/websocket) — current Elysia `.ws()` routes, lifecycle hooks, schema validation, and handler ownership. This informs the WebSocket route boundary and keeps validation out of the room domain.
2. [Bun WebSockets](https://bun.sh/docs/runtime/http/websockets) — `Bun.serve` upgrade behavior, `ServerWebSocket` data, topic publish/subscribe, backpressure, payload limits, and close handling. This informs the runtime limits and the room adapter.
3. [Elysia WebSocket example source](https://raw.githubusercontent.com/elysiajs/elysia-websocket/main/example/index.ts) — archived example showing a room route that subscribes on open, publishes accepted messages, and announces close. This informs the room lifecycle shape, but its old plugin import is not used.
4. [MDN: WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) — browser connection states, events, close behavior, and cleanup. This informs the client connection hook and accessible connection status.
5. [Zod discriminated unions](https://zod.dev/api?id=discriminated-unions) — shared runtime schemas for trusted-in-code TypeScript contracts and untrusted WebSocket payloads. This informs message parsing and classified protocol errors.

## Goal

Two unauthenticated browser clients open the same `/whiteboard?room=demo`
room. Both see a connected-room status. When one client creates or moves a
shape, the other client receives the accepted document operation and renders
the same resulting scene without a page reload.

The smallest proven path is:

```text
local canvas commit
    -> shared Zod operation
    -> browser WebSocket
    -> Elysia room route
    -> room validation and ordered in-memory apply
    -> publish to other room members
    -> client validation and scene application
    -> CanvasSurface redraw and visible status
```

The realtime process is authoritative for room membership and accepted
operation order in this slice. It is not durable and it does not attempt CRDT
convergence; those are later boundaries.

## Non-goals

- No authentication, authorization, document permissions, PostgreSQL,
  ZenStack, tRPC, Redis, Yjs, offline queue, or durable room state.
- No cursor/presence messages; those belong to Slice 5.
- No CRDT, vector clocks, conflict-free concurrent edits, or offline replay;
  the server accepts operations in arrival order and the last accepted move
  wins.
- No binary protocol, compression tuning, horizontal scaling, or cross-process
  pub/sub.
- No server actions or feature-specific Next.js API routes. The browser talks
  directly to the separate realtime WebSocket process.
- No reconnect queue or automatic replay of unsent local operations. A
  disconnected client must show the failure and require a fresh room join.

## Design

### Core mental model

```text
Next.js App Router page
    -> client room controller opens ws://realtime/ws/:roomId
    -> join with stable tab client ID and initial local scene
    -> realtime route validates and enters an in-memory room
    -> first join establishes the room scene; later joins receive room state
    -> local create/move commits are sent as operations
    -> server validates, applies in arrival order, increments revision
    -> server publishes accepted operation to other members
    -> clients apply remote operation to their committed scene
    -> canvas renders and announces connected/updated/error state
```

The supplied [Elysia WebSocket example](https://github.com/elysiajs/elysia-websocket/tree/main/example)
uses a path-scoped room, subscribes connections when they open, publishes
messages to the room, and broadcasts a leave event on close. The repository is
archived, and its `@elysiajs/websocket` plugin is not the implementation target.
Use current Elysia `.ws()` support, which follows Bun's WebSocket model, and
keep the current `apps/realtime` process as the composition root.

### Authority and state

- The room server owns membership, the accepted scene, and a monotonically
  increasing room revision for the life of the process.
- A room is keyed by a validated `roomId` path parameter and contains a bounded
  map of connection IDs plus the current in-memory `Scene`.
- The first valid join supplies the deterministic initial scene. Subsequent
  joins receive `room-state`; their supplied initial scene is ignored.
- A local client applies its own operation immediately for responsive canvas
  interaction, then sends it. The server is the authority for whether it is
  accepted and broadcasts the accepted operation with the new revision.
- A client never treats raw WebSocket JSON as a `SceneOperation`. It parses the
  shared Zod schema at the message boundary, then maps the validated DTO into
  the existing pure canvas operation helpers.
- Shape IDs become opaque globally unique IDs for this slice, for example
  `${clientId}:rectangle:${counter}`. Existing renderer, hit-test, and drag
  invariants remain unchanged; tests must stop assuming `rectangle-2` is a
  permanent ID.

### Room lifecycle

Use an Elysia route such as `/ws/:roomId` with these ownership rules:

- `beforeHandle`/route parsing validates the room ID and rejects malformed
  paths before upgrade.
- `open` stores the connection metadata, subscribes it to a room topic, and
  sends `joined` plus the current `room-state`.
- `message` parses the client envelope, checks that the connection has joined,
  validates the operation, applies it once to the room scene, and publishes
  only accepted operations to other members.
- `close` removes the connection, unsubscribes it, publishes a member-count
  update, and deletes an empty room from the in-memory registry.
- The route config sets a bounded `maxPayloadLength` and a finite idle timeout.
  The room layer remains independent of Elysia and can be tested with fake
  connections.

No document operation is written to PostgreSQL. No Redis topic is introduced;
Bun/Elysia room publish is sufficient while one realtime process is the stated
boundary.

### Client state and UI

Add a client room controller around `InteractiveCanvas`:

- `connectionState` is React state: `idle`, `connecting`, `connected`,
  `disconnected`, or `error`.
- `roomState` holds the last accepted scene and revision. It is server-derived
  document state, not Zustand state.
- The WebSocket instance, client ID, and cleanup callback live in refs.
- Pointer draft state remains owned by the existing canvas interaction refs.
  Pointer moves do not send operations; only committed create/move events do.
- Editing controls are disabled until `room-state` is received. This avoids
  creating local operations against an unknown room revision.
- The page exposes a polite status such as `Connected to demo`,
  `Alice's operation applied`, `Reconnecting is not available`, or
  `Disconnected from the room. Refresh to join again.`

The existing local scene remains the renderer input contract. The room hook
only supplies committed scene values and operation callbacks; it does not
touch a CanvasRenderingContext2D.

### Repository and feature ownership

```text
apps/realtime/src/
├── index.ts                    # Elysia/Bun composition and health route
├── rooms/
│   ├── room-registry.ts        # Room membership and in-memory scene authority
│   ├── room-registry.test.ts   # Join, apply, broadcast, close, isolation
│   └── operations.ts           # Validated operation application boundary
└── transport/
    ├── websocket-route.ts      # Upgrade, lifecycle, parse, publish adapter
    └── websocket-route.test.ts # Malformed and lifecycle protocol behavior

packages/contracts/src/
├── index.ts                    # Existing room ID contract and exports
└── document-operations.ts      # Zod client/server envelopes and DTO types

apps/web/src/features/
├── canvas/
│   ├── interactive-canvas.tsx  # Emits local committed operations
│   └── operations.ts           # Maps validated DTOs to pure Scene changes
└── collaboration/
    ├── room-connection.ts      # Browser WebSocket lifecycle adapter
    ├── room-connection.test.ts # Parse, state, cleanup, and failure behavior
    └── collaborative-whiteboard.tsx # Room status + canvas composition

tests/e2e/whiteboard-collaboration.spec.ts # Two-browser observable flow
```

Do not move the room registry into the Next.js app. Do not let React components
parse messages or encode room policy. Do not add Elysia to the web app.

## Interfaces

### Shared transport contracts

The contracts package owns the runtime schemas and inferred DTO types. The
wire format intentionally uses a discriminated envelope so unsupported or
malformed messages can be rejected without guessing their shape.

```ts
import { z } from "zod";

export const roomIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const clientIdSchema = z.string().min(8).max(128);
export const operationIdSchema = z.string().uuid();

const pointSchema = z.object({
  x: z.number().finite().abs().lte(1_000_000),
  y: z.number().finite().abs().lte(1_000_000),
});

const shapeSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(256), type: z.literal("rectangle"),
    position: pointSchema, width: z.number().positive().lte(10_000),
    height: z.number().positive().lte(10_000), fill: z.string().max(32),
  }),
  z.object({
    id: z.string().min(1).max(256), type: z.literal("circle"),
    center: pointSchema, radius: z.number().positive().lte(10_000),
    fill: z.string().max(32),
  }),
]);

export const sceneOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"), operationId: operationIdSchema,
    clientId: clientIdSchema, shape: shapeSchema,
  }),
  z.object({
    kind: z.literal("move"), operationId: operationIdSchema,
    clientId: clientIdSchema, shapeId: z.string().min(1).max(256),
    position: pointSchema,
  }),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), clientId: clientIdSchema,
    initialScene: z.array(shapeSchema).max(10_000) }),
  z.object({ type: z.literal("operation"), operation: sceneOperationSchema,
    revision: z.number().int().nonnegative() }),
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), roomId: roomIdSchema,
    clientId: clientIdSchema, revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("room-state"), scene: z.array(shapeSchema),
    revision: z.number().int().nonnegative(), memberCount: z.number().int().positive() }),
  z.object({ type: z.literal("operation"), operation: sceneOperationSchema,
    revision: z.number().int().positive() }),
  z.object({ type: z.literal("room-status"), memberCount: z.number().int().nonnegative() }),
  z.object({ type: z.literal("protocol-error"), code: z.enum([
    "invalid-message", "not-joined", "invalid-operation", "room-unavailable",
  ]), message: z.string().max(256) }),
]);
```

The actual implementation may split schemas for readability, but there must
be one authoritative runtime schema per envelope. The server validates every
incoming message; the browser validates every received message. The server
remains authoritative for membership and operation acceptance, while this
unauthenticated slice has no capability decision beyond being joined.

### Room boundary

```ts
type Room = {
  roomId: string;
  scene: readonly Shape[];
  revision: number;
  members: Map<string, RoomMember>;
};

type RoomMember = {
  clientId: string;
  publish: (message: ServerMessage) => void;
};

type ApplyResult =
  | { ok: true; scene: Scene; operation: SceneOperation; revision: number }
  | { ok: false; code: "invalid-operation"; message: string };

interface RoomRegistry {
  join(roomId: RoomId, member: RoomMember, initialScene: Scene): RoomSnapshot;
  apply(roomId: RoomId, clientId: string, operation: SceneOperation): ApplyResult;
  leave(roomId: RoomId, clientId: string): void;
}
```

The registry receives validated DTOs and returns domain results. It does not
know Elysia, `ServerWebSocket`, React, or browser events. `apply` must reject
unknown shape IDs, duplicate operation IDs, invalid shape creation IDs, and
operations from non-members without mutating the room.

### Browser connection boundary

```ts
type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; roomId: string; revision: number; memberCount: number }
  | { kind: "closed"; reason: string };

type RoomConnection = {
  state: ConnectionState;
  sendOperation: (operation: SceneOperation, revision: number) => boolean;
  close: () => void;
};
```

`room-connection.ts` owns `WebSocket`, event handlers, join payload, parse
errors, and cleanup. It emits typed callbacks such as `onRoomState`,
`onOperation`, and `onStatus`; the canvas receives only validated operations.
On unmount, it removes handlers and closes the socket with a normal close code.

## Execution flow

### Join and initial state

```text
open /whiteboard?room=demo
  -> validate room query; fallback to demo
  -> generate one tab clientId
  -> connection state = connecting
  -> WebSocket opens /ws/demo
  -> send join(clientId, initialScene)
  -> server validates and joins the room
  -> first member establishes scene; later member receives current scene
  -> server sends joined + room-state
  -> client replaces committed scene, revision, and member count
  -> connection state = connected; enable editing controls
```

### Local operation

```text
pointerup commits local create/move
  -> generate globally unique shape/operation ID
  -> apply operation locally through existing pure scene helper
  -> send operation + current revision
  -> server validates membership, IDs, bounds, and operation semantics
  -> server applies in arrival order and increments revision
  -> server publishes accepted operation to other members
  -> sender keeps its optimistic scene; peers apply the operation
  -> all clients update visible revision/status
```

The server should publish to other room members, matching the referenced
room-broadcast pattern. If an implementation publishes to the sender too,
the client must deduplicate by `operationId`; do not apply a local operation
twice.

### Remote operation

```text
message event
  -> parse serverMessageSchema
  -> operation DTO mapped to SceneOperation
  -> if operationId already applied, ignore safely
  -> apply create/move to committed scene
  -> update revision and status
  -> CanvasSurface redraws from the new scene
```

### State transitions

```text
idle
  -> connecting
  -> connected (join accepted, room-state received)
  -> applying-local (optimistic local commit, send operation)
  -> connected (accepted broadcast or local acknowledgement)
  -> closed (normal close, server close, or cleanup)
  -> error (protocol/network failure; preserve last accepted scene)
```

No operation is queued after `closed` in this slice. The user can refresh to
join again; future work may add reconnect and durable pending-operation state.

## Failure cases

| Failure | User-visible behavior | Recovery / invariant |
|---|---|---|
| Invalid room ID | Room page shows a clear invalid-room status and does not open a socket | Path/query is validated before room creation |
| WebSocket unavailable | Canvas is read-only with `Unable to connect to room`; retry/refresh guidance appears | Last local/initial scene is preserved; no false connected status |
| Malformed client message | Server sends `protocol-error` and ignores the message | Room scene and revision do not change |
| Malformed server message | Client records protocol error and closes the connection | Raw payload never reaches canvas state |
| Operation from non-member | Server rejects it and does not broadcast | Membership is checked in the room boundary |
| Unknown or duplicate operation ID | Sender sees rejected/error status; peers see no duplicate shape/move | Apply is atomic and idempotency is bounded per room |
| Invalid shape bounds or oversized payload | Server rejects with `invalid-operation` | Zod schema and `maxPayloadLength` protect the room |
| Client disconnects during send | UI shows disconnected; the operation is not retried automatically | No unbounded queue; refresh starts a fresh join |
| Client joins an existing room | Client receives current `room-state` before editing | Server room scene, not the client's initial scene, is authoritative |
| Empty room after close | Room is removed from the registry | No room or socket reference leaks after close |
| Two moves arrive close together | Server applies deterministic arrival order; later accepted move wins | CRDT/convergence remains explicitly deferred to Slice 6 |

## Tests

### Shared contract tests — Vitest

- Accept valid join, create, move, room-state, and protocol-error messages.
- Reject unknown message kinds, non-finite coordinates, oversized IDs,
  negative dimensions, oversized scenes, and malformed discriminators.
- Confirm server and browser use the same schemas exported from
  `@whiteboard/contracts`.

### Room domain tests — Vitest

- First member creates a room and receives its initial state.
- Second member receives the existing scene and member count.
- Accepted create/move operations increment revision and broadcast only to
  other members.
- Unknown shape, duplicate operation, non-member operation, and malformed
  operation leave scene and revision unchanged.
- Closing a member publishes the updated count and deletes an empty room.
- Different room IDs never receive each other's operations.

### Browser connection tests — Vitest/integration

- Join sends one validated payload and reaches `connected` only after
  `room-state` arrives.
- A valid remote operation updates the public scene description/status.
- Invalid incoming payload closes or marks the connection as protocol-error
  without mutating the scene.
- Unmount closes the socket and removes handlers; later messages are ignored.

### Browser test — Playwright

Add `tests/e2e/whiteboard-collaboration.spec.ts` using two isolated browser
contexts:

1. Open both pages at `/whiteboard?room=demo` and wait for both accessible
   statuses to say they are connected.
2. Create a rectangle in client A and assert client A reports success.
3. Assert client B's scene description and status show the same created shape.
4. Move that shape in client B and assert client A reports the resulting
   position.
5. Close client B and assert client A's member count/status updates.
6. Send an invalid message only through a test WebSocket fixture and assert it
   cannot change either scene.

Assertions must use accessible status, tool controls, scene description, and
visible canvas outcomes. Do not inspect room maps, React refs, or canvas
context calls.

### Verification commands

```sh
bun run test:unit
bun run test:e2e -- tests/e2e/whiteboard-collaboration.spec.ts
bun run typecheck
bun run lint
bun run build
```

The E2E harness must start both `apps/web` and `apps/realtime` on deterministic
ports and stop both processes after the run.

## Definition of done

- Two browser clients can join the same validated room path and both receive a
  connected state plus the current room scene.
- A committed local create or move is encoded by shared Zod contracts, sent
  over WebSocket, accepted by the room registry, and rendered by the peer.
- The server validates payload size, message shape, membership, operation IDs,
  shape IDs, and geometry before mutating or broadcasting.
- The room registry is transport-independent, ordered, bounded, and cleans up
  members and empty rooms.
- The browser validates incoming messages, handles connection failure and
  cleanup, and never lets raw network objects enter canvas logic.
- Canvas pointer moves remain local and high-frequency; only committed
  operations cross the network boundary.
- The UI exposes connected, connecting, disconnected/error, and updated states
  through accessible status feedback; editing is disabled before room state.
- Unit/integration tests cover contracts, room isolation, join/leave, invalid
  operations, cleanup, and remote operation application.
- Playwright verifies two-client create, move, and disconnect behavior.
- `bun run test:unit`, focused Playwright tests, typecheck, lint, and build pass.
- Slice 4 is marked `[x]` in `docs/01.implementation-slices.md` only after
  every criterion passes.

## Future improvements

- Slice 5 adds ephemeral cursor/presence messages with throttling and render-only
  state; it must not write cursors into the room document.
- Slice 6 replaces arrival-order room mutation with a convergent shared
  document/CRDT boundary and preserves the public scene/render contracts.
- Add reconnect with bounded pending operations only after a replay/ordering
  policy is designed.
- Add authentication and authorization before exposing non-demo rooms or
  persistence.
- Add Redis only when more than one realtime process is required; keep the room
  registry interface stable while replacing its fan-out implementation.
- Evaluate Elysia's typed client/Eden integration later; this slice keeps the
  browser on the standard WebSocket API to avoid coupling UI code to transport
  tooling.
