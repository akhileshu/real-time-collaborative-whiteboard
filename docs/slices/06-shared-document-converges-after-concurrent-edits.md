# Slice 6 — Shared Document Converges After Concurrent Edits

## What To Study

1. [Yjs Document Updates](https://docs.yjs.dev/api/document-updates) — Yjs maintainers.
   Read the update API and convergence guarantees; this informs binary update
   transport, idempotent application, and state snapshots.
2. [Y.Doc API](https://docs.yjs.dev/api/y.doc) — Yjs maintainers.
   Read transactions, update observers, origins, and destroy; this informs the
   adapter lifecycle and prevents rebroadcast loops.
3. [Yjs Shared Types](https://docs.yjs.dev/getting-started/working-with-shared-types) — Yjs maintainers.
   Read Y.Map/Y.Array usage; this informs the minimal scene representation for
   shape records and stable draw order.
4. [MDN WebSocket binary data](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType)
   — MDN Web Docs. Use the browser boundary to choose base64 JSON for this
   slice, avoiding browser/runtime binary differences until measured.

## Goal

When two unauthenticated clients edit the same `/whiteboard?room=<id>` room at
the same time, both eventually render the same rectangle/circle scene. A local
create or move remains responsive, concurrent updates are merged through a
shared CRDT document, and reconnect-free live collaboration does not depend on
arrival order or a numeric room revision.

The smallest proven path is:

```text
local create/move
    -> Y.Doc transaction
    -> base64 Yjs update
    -> existing WebSocket room
    -> server room Y.Doc apply/update broadcast
    -> peer Y.Doc apply
    -> Scene projection
    -> existing CanvasSurface redraw
```

## Non-goals

- No offline queue, reconnect replay, durable snapshots, PostgreSQL, Redis, or
  persistence provider.
- No authentication, authorization, per-shape permissions, or trusted user
  identity; those must be designed before accepting arbitrary persisted edits.
- No delete, text, resize, selection, undo/redo, awareness, or cursor changes;
  Slice 5 presence remains on its existing protocol path.
- No Yjs provider package. The current room WebSocket is the only transport.
- No requirement that an operation's old `revision` wins. Revision is removed
  from document correctness; Yjs update delivery and idempotency provide the
  convergence contract.
- No offline conflict UI or guaranteed delivery after socket close. Unsynced
  local edits are not claimed as saved or durable.

## Design

### Core mental model

```text
pointer commit
    -> scene operation adapter
    -> local Y.Doc transaction
    -> local Scene projection + update event
    -> room connection sends document-update
    -> server validates envelope, applies candidate update, broadcasts it
    -> peers apply update exactly/at-least once safely
    -> Y.Doc observes change and projects canonical Scene
    -> canvas renders; connection status reports sync/error
```

Yjs is introduced only behind a `SharedDocument` adapter. The adapter owns a
`Y.Doc`, a `Y.Array<string>` for shape order, and a `Y.Map<Y.Map<unknown>>` for
shape records. A create inserts a shape ID and record; a move updates the
record's position/center. The adapter projects only validated `WireShape`
values into the existing `Scene` type. Rendering, pointer interaction, and
cursor presence do not import Yjs.

The realtime room owns one adapter per room and broadcasts accepted updates to
all other members. It applies an incoming update to a cloned candidate doc,
projects and validates the candidate scene, then commits it to the room doc.
This keeps malformed Yjs content from corrupting room state. The server does
not impose arrival-order conflict semantics; concurrent Yjs updates are
commutative, associative, and idempotent when all accepted updates arrive.

The client owns one adapter for the lifetime of one room connection. Local
transactions use origin `"local"`; updates caused by a remote apply use origin
`"remote"` and are not sent again. Every adapter and WebSocket listener is
destroyed/removed on unmount or close so an old room cannot mutate a new one.

### Repository and feature ownership

```text
apps/realtime/src/
├── rooms/
│   ├── room-registry.ts             # Membership and room adapter ownership
│   ├── shared-document.ts           # Server-side Y.Doc lifecycle/projection
│   └── shared-document.test.ts      # Merge, duplicate, invalid projection
└── transport/
    └── websocket-route.ts           # Validate/update/broadcast adapter output

packages/contracts/src/
├── document-operations.ts           # Update envelope and size-safe contracts
└── shared-document.ts               # Shared Y.Doc scene encoding/projection

apps/web/src/features/
├── canvas/operations.ts             # Existing local SceneOperation mapping
└── collaboration/
    ├── shared-document.ts           # Browser Y.Doc adapter and projection
    ├── room-connection.ts            # Update send/receive lifecycle
    └── collaborative-whiteboard.tsx  # Scene/status composition only

tests/e2e/whiteboard-collaboration.spec.ts # Concurrent observable workflow
```

The existing `RoomRegistry` membership API and `PresenceRegistry` remain
stable, but `scene`, `revision`, and `seenOperationIds` cease to be the
document authority. A later persistence slice may store the adapter's encoded
state without changing the renderer contract.

## Interfaces

### Shared transport contract

The runtime schema remains the authority for untrusted WebSocket input. Use
base64 JSON for the first implementation because it works with the current
Elysia parser and browser socket abstraction; cap decoded update bytes below
the existing WebSocket payload limit.

```ts
import { z } from "zod";

export const documentUpdateSchema = z.object({
  type: z.literal("document-update"),
  update: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(64_000),
}).strict();

export const serverDocumentStateSchema = z.object({
  type: z.literal("document-state"),
  update: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(64_000),
}).strict();

type SharedDocumentEvents = {
  onScene: (scene: Scene) => void;
  onLocalUpdate: (update: Uint8Array) => void;
  onApplyError: (reason: string) => void;
};

interface SharedDocument {
  readonly scene: Scene;
  applyOperation(operation: SceneOperation): void;
  applyUpdate(update: Uint8Array): void;
  encodeState(): Uint8Array;
  destroy(): void;
}
```

`SceneOperation` and `WireShape` remain the existing contracts for interaction
and validation. The server decides room membership and whether a candidate
document projection is valid. The runtime schema validates the envelope and
base64 representation; the adapter validates decoded shape data. The client
renders the adapter's server/CRDT-derived scene and never decides whether an
update is authorized or accepted.

### Update identity and errors

Yjs itself makes duplicate updates safe, so no client operation-ID set is
needed for convergence. Classify adapter/transport failures as:

```ts
type DocumentError =
  | { kind: "invalid-message"; message: string }
  | { kind: "invalid-document"; message: string }
  | { kind: "too-large"; message: string }
  | { kind: "not-joined"; message: string }
  | { kind: "unavailable"; message: string };
```

Malformed updates are rejected without changing the room or client document.
No optimistic rollback protocol is added: the local Y.Doc is already the
client's immediate editing state, and a transport failure closes the room with
the unsent state clearly described as non-durable.

### Component inputs and cache

`CollaborativeWhiteboard` continues to receive `{ roomId, initialScene }` and
passes a projected `Scene` to `InteractiveCanvas`. Document state is not put in
Zustand or TanStack Query; it is high-frequency live state owned by the room
adapter and mirrored into the component only when the adapter emits a changed
scene. Cursor state remains in the existing imperative overlay.

## Execution flow

1. On room creation, the client constructs a Y.Doc adapter and registers one
   update listener. The first room member seeds the server document from the
   existing deterministic `initialScene`; later members receive
   `document-state` and ignore their local seed.
2. On a committed create/move, the adapter performs one Yjs transaction,
   projects the scene immediately, and emits the resulting update. The room
   connection sends `document-update` only while the socket is open.
3. The server validates the message, decodes base64, rejects oversized bytes,
   applies it to a candidate document, and accepts it only if the projection
   passes the existing shape limits. It then applies the update to the room
   document and broadcasts the same update to other joined clients.
4. Each peer decodes and applies the update with origin `"remote"`. The adapter
   projects the resulting scene once per Yjs transaction and the canvas redraws
   from that scene. Reapplying an already received update is harmless.
5. The room sends a full encoded state to a new member. The client replaces its
   pre-join seed with that state, emits the projected scene, and reports
   `Synchronized` only after the state is applied successfully.
6. On close/unmount, remove the Yjs update observer, call `doc.destroy()`,
   close the socket, and clear cursor resources using the existing cleanup.

State transitions:

```text
idle
  -> connecting
  -> syncing (socket joined; document-state pending)
  -> synchronized (scene projection available)
  -> applying (local or remote transaction)
  -> synchronized
  -> error (invalid update; preserve last valid scene)
  -> closed (socket unavailable; local unsent edits are not durable)
```

Do not use optimistic server revision checks or an automatic retry queue in
this slice. The observable invariant is that two live clients reach equal
projected scenes after both accepted updates have arrived.

## Failure cases

- Invalid JSON, invalid base64, decoded bytes over the limit, or a malformed
  Yjs update: reject the message, preserve the last valid scene, and show a
  retryable protocol status; the server broadcasts nothing.
- A valid Yjs update that projects to an unsupported shape, duplicate order
  entry, non-finite coordinate, or over-limit scene: reject the candidate and
  leave the authoritative room document unchanged.
- Update before join: return `not-joined`; do not create a room document.
- Duplicate or reordered updates: apply safely; Yjs idempotency means the
  projected scene remains unchanged after the first application.
- Concurrent creates: retain both shapes with one deterministic converged
  Y.Array order. Concurrent moves of the same shape use Yjs last-writer
  conflict resolution and produce the same result on all replicas; the UI does
  not claim a domain-specific winner.
- Socket close during send: keep the last valid local scene for the current
  tab, show that the room is closed, and do not claim the edit was delivered or
  saved. Rejoining starts from the server's current state.
- Adapter/listener failure: stop applying further updates, preserve the last
  valid projection, destroy the adapter, and expose a visible error rather than
  silently rendering divergent state.

## Tests

| Scenario | Level | Expected observable behavior |
|---|---|---|
| Two local docs apply concurrent creates in opposite orders | Unit | Both projections contain both shapes and serialize to equal scene data |
| Two local docs move the same shape concurrently | Unit | Both projections choose the same Yjs result after exchanging updates |
| Duplicate and reordered updates | Unit | Applying updates repeatedly or in another order is safe and converges |
| Invalid projection/update size | Server integration | Candidate is rejected; room scene and peers remain unchanged |
| Adapter cleanup | Unit/integration | Observer is removed and destroyed docs no longer emit updates |
| Two browser clients create/move concurrently | Playwright | Both canvases expose the same scene summary after synchronization |
| Connection closes during collaboration | Playwright | Closed status is visible and no success/save claim is shown |

The Playwright test should use two isolated contexts and a unique room ID. Use
accessible connection/activity status plus a test-only scene summary derived
from the rendered scene; do not assert private Yjs maps, update bytes, or
canvas pixels. Keep cursor assertions covered by Slice 5 tests.

## Definition of done

- [x] Yjs is added to the shared contracts package that owns the reusable
  document adapter; web and realtime consume it without a provider or
  persistence package.
- [x] Shared contracts validate `document-update` and `document-state` with a
  bounded base64 payload.
- [x] The server room owns one Y.Doc adapter, validates candidate projections,
  and broadcasts accepted updates without revision-order conflict logic.
- [x] The browser maps existing create/move interactions into Yjs transactions
  and renders only the adapter's projected `Scene`.
- [x] Local/remote update origins prevent rebroadcast loops; cleanup destroys
  observers, docs, sockets, and cursor resources.
- [x] Unit tests prove concurrent create/move convergence, duplicate safety,
  invalid-update rejection, and cleanup.
- [x] The two-client Playwright flow proves equal visible scenes after
  concurrent edits and clear closed/error feedback.
- [x] `bun run test:unit`, `bun run typecheck`, `bun run lint`, `bun run build`,
  and `bun run test:e2e` pass serially.
- [x] Metrics expose rejected update count, decoded update bytes, apply
  failures, and active room document count without logging document contents.

## Future improvements

- Add a durable snapshot/update persistence adapter in Slice 7 without making
  PostgreSQL part of the CRDT transport contract.
- Add bounded offline update storage and state-vector replay only after a
  reconnect protocol and data-loss behavior are specified.
- Add delete/resize/text operations with explicit domain invariants rather than
  exposing arbitrary Yjs values.
- Add authentication and server-side capability checks before persistence or
  shared document access becomes multi-tenant.
- If update size or CPU measurements require it, move from base64 JSON to
  binary WebSocket frames and consider `Y.mergeUpdates`; keep scene convergence
  and renderer behavior unchanged.
