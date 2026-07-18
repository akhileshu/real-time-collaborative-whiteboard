# Slice 8 — High-Frequency Updates Are Buffered Safely

## What To Study

1. [Bun server lifecycle](https://bun.sh/docs/runtime/http/server) — Bun documentation.
   Read `server.stop()`; this informs the shutdown order: stop accepting work,
   drain persistence, then close the server.
2. [Bun WebSocket backpressure](https://bun.sh/docs/runtime/http/websockets) — Bun documentation.
   Read the `send()` result meanings and payload/backpressure limits; this keeps
   persistence buffering separate from socket backpressure and avoids treating
   cursor traffic as durable state.
3. [Prisma upsert reference](https://www.prisma.io/docs/orm/reference/prisma-client-reference#upsert) — Prisma documentation.
   Read unique-key upsert behavior; this supports retrying an idempotent latest
   snapshot for each `roomId`.
4. [Prisma transactions and batch queries](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) — Prisma documentation.
   Read idempotent API guidance; this informs retrying the same snapshot without
   creating revisions or duplicate board rows.

## Goal

When collaborators edit a room rapidly, accepted document updates mark the room
dirty and the realtime process eventually persists only the newest validated
scene snapshot. The system bounds memory, retries transient persistence failures,
and drains pending snapshots during graceful shutdown so a final accepted edit is
not abandoned merely because a save was scheduled asynchronously.

The smallest successful path is:

```text
accepted document update
    -> latest room scene projected to BoardSnapshot
    -> bounded dirty-board buffer keyed by roomId
    -> debounce timer
    -> existing web tRPC Board.upsert HTTP boundary
    -> PostgreSQL jsonb
```

## Non-goals

- No per-update database writes, revision history, offline queue, or durable
  message log.
- No Redis, multi-process coordination, distributed locks, or exactly-once
  delivery guarantee.
- No persistence of cursor/presence messages or raw Yjs update bytes.
- No optimistic client persistence status; the browser continues to use the
  explicit-save behavior from Slice 7 unless a later UI slice adds autosave
  feedback.
- No new API route or server action. The existing App Router tRPC route remains
  the only HTTP data adapter.
- No silent loss when the bounded buffer cannot admit a new dirty room: the
  document update is rejected before it becomes authoritative and the client is
  told to retry.

## Design

### Core mental model

```text
WebSocket document update
    -> transport validates bytes and room membership
    -> reserve dirty-board capacity
    -> validate candidate document and apply it to RoomRegistry
    -> enqueue latest BoardSnapshot for roomId
    -> debounce/coalesce
    -> persistence adapter calls web tRPC Board.upsert
    -> retry transient failure or retain bounded pending state
    -> shutdown waits for drain before server stop completes
```

The `RoomRegistry` remains the live source of truth. After a candidate update is
validated, the room produces a JSON `BoardSnapshot` from its projected scene;
the persistence buffer owns no Y.Doc and never stores cursor traffic. A room is
marked dirty only after its update is accepted. To preserve the no-loss boundary,
the buffer reserves a slot before applying an update when the room is not already
dirty. If no slot is available, the update is rejected and the room is unchanged.

The buffer has one entry per `roomId`, a configurable maximum number of dirty
rooms, and one debounce timer per entry. New snapshots replace older snapshots
for the same room. A flush captures the current entry, marks it in-flight, and
does not remove a newer snapshot that arrived while the write was running. A
successful write removes only the captured snapshot; a failed write retains the
latest snapshot and schedules bounded exponential retries.

The production adapter is a thin realtime-side HTTP client for the existing web
`/api/trpc` route and maps the generated `Board.upsert` input. It does not import
Prisma or ZenStack. Tests inject the interface directly. The web server remains
the authority for runtime validation, public policy, and PostgreSQL writes.

### Repository and feature ownership

```text
apps/realtime/src/
├── persistence/
│   ├── board-snapshot-persistence.ts  # stable interface + tRPC HTTP adapter
│   └── snapshot-buffer.ts              # bounded coalescing/retry/drain logic
├── rooms/room-registry.ts              # live scene and admission reservation
├── transport/websocket-route.ts        # enqueue after accepted updates
└── index.ts                            # create adapter, signal shutdown, drain

packages/contracts/src/
└── board-snapshot.ts                   # shared schema and byte/shape limits

apps/web/schema.zmodel                  # authoritative Board model/policy
apps/web/src/app/api/trpc/[trpc]/route.ts # existing persistence HTTP boundary
docs/slices/08-buffered-board-snapshot-flush.md
```

Generated Prisma and ZenStack files remain derived artifacts. No dependency is
added: the adapter uses the existing tRPC wire boundary and `fetch`; the
buffer's clock, retry policy, and persistence implementation are injected for
deterministic tests.

## Interfaces

### Persistence contract

```ts
import type { BoardSnapshot, RoomId } from "@whiteboard/contracts";

export type SnapshotWrite = {
  roomId: RoomId;
  snapshot: BoardSnapshot;
};

export type BoardSnapshotPersistence = {
  upsert: (write: SnapshotWrite) => Promise<void>;
};
```

`upsert` is idempotent because `roomId` is unique and the operation writes the
latest snapshot. The adapter must classify HTTP/tRPC responses as retryable
unavailable failures or terminal validation/policy failures; it must not expose
Prisma error details to the realtime transport.

### Buffer contract

```ts
export type SnapshotBufferOptions = {
  maxDirtyRooms: number;
  debounceMs: number;
  maxAttempts: number;
  retryDelaysMs: readonly number[];
};

export type SnapshotBuffer = {
  reserve: (roomId: RoomId) => boolean;
  enqueue: (write: SnapshotWrite) => void;
  flush: (roomId?: RoomId) => Promise<void>;
  drain: () => Promise<void>;
  pendingRoomCount: () => number;
};
```

`reserve` succeeds when the room already has an entry or when the bounded map has
capacity. `enqueue` accepts only a validated snapshot and coalesces by room.
`flush(roomId)` is useful for tests and shutdown; `drain()` cancels debounce
timers, flushes all rooms, and resolves only when no in-flight or retryable work
remains. A terminal failure is retained as a failed entry until the next dirty
write or an operator-visible drain result; it is never reported as durable.

### Transport capability/error contract

Extend the shared protocol's classified error set with a persistence-capacity
failure (or reuse the existing room-unavailable envelope while preserving the
specific server log/metric). The client renders a retryable connection/activity
message and does not alter its local Y.Doc when the server rejects the update.

The browser remains unaware of buffer depth, debounce timers, or retry counts.
The server decides whether an update can be accepted and when it is durable.

## Execution flow

### Normal update

1. Parse and validate the WebSocket `document-update` at the transport boundary.
2. Confirm membership and validate the update against a disposable candidate
   document, as established in Slice 6.
3. Ask the buffer to reserve `roomId`; if it cannot, send a retryable protocol
   error and stop before changing the authoritative room.
4. Apply the update to `RoomRegistry`, increment the revision, and project the
   accepted scene with `createBoardSnapshot`.
5. Enqueue the snapshot and broadcast the accepted document update to peers.
6. After the debounce interval, call the injected persistence adapter. A newer
   snapshot supersedes any older queued snapshot for that room.

### Flush and retry

```text
dirty
  -> scheduled (coalesce same-room updates)
  -> flushing (one write per room)
  -> clean (write succeeded; remove captured snapshot)
  -> retry-wait (transient failure; retain latest snapshot)
  -> flushing (bounded retry)
  -> failed (attempt budget exhausted; retain failure and report metric)
```

Retries use a small bounded schedule such as 100 ms, 500 ms, and 2 s. A write
that succeeds after a newer enqueue leaves the newer snapshot scheduled. There
is no optimistic database/cache update because this process has no client query
cache.

### Shutdown

```text
SIGTERM/SIGINT
  -> stop accepting new updates / close upgrade path
  -> cancel debounce timers
  -> await buffer.drain()
  -> await Bun/Elysia server.stop()
  -> exit with failure if pending snapshots could not be persisted
```

The production entrypoint owns one idempotent shutdown promise so both signals
cannot start two drains. A shutdown deadline may be configured; if it expires,
log the affected room IDs and exit non-zero rather than claiming the snapshots
were saved. Existing WebSocket document cleanup still runs when connections
close; the persistence buffer must outlive room deletion until its snapshot has
flushed.

## Failure cases

- **Invalid or oversized update:** reject at the existing transport/document
  boundary; do not reserve or enqueue; peers and database remain unchanged.
- **Buffer at capacity:** reject the new room's update with a retryable protocol
  error before applying it; an already dirty room may continue coalescing.
- **Web/tRPC unavailable:** retain the newest snapshot, increment failure
  metrics, and retry with bounded backoff. The live room continues operating, but
  shutdown reports failure if the snapshot cannot drain.
- **Terminal validation/policy failure:** retain the failed entry for
  operator-visible diagnostics, stop retrying that entry, and never claim it is
  durable. The next accepted snapshot replaces it and gets a fresh attempt
  budget.
- **Update arrives during flush:** keep the newer snapshot and flush it after
  the in-flight write; never delete it using the older write's completion.
- **Room becomes empty:** remove its live Y.Doc as today, but do not remove its
  pending buffer entry. The latest scene still needs to be persisted.
- **Shutdown during retry wait:** cancel the timer and perform the pending write
  during `drain`; preserve the latest snapshot if the final attempt fails.

## Tests

| Scenario | Level | Expected observable behavior |
|---|---|---|
| Rapid updates to one room | Unit | One persistence call receives the latest snapshot after debounce; intermediate snapshots are not written. |
| Dirty-room capacity | Unit/integration | A new room update is rejected before room state changes when the bound is full; an existing dirty room can still coalesce. |
| Successful flush | Unit | Buffer becomes clean only after `upsert` resolves and `pendingRoomCount()` reaches zero. |
| Transient failure | Unit | Latest snapshot remains pending, retries follow the configured bounded schedule, and a later success clears it. |
| New update during in-flight write | Unit | The newer snapshot is written after the older captured write completes. |
| Empty room with pending snapshot | Integration | Leaving the last client does not discard the pending board write. |
| Shutdown drain | Integration | Calling the injected shutdown function awaits pending writes before server stop is invoked. |
| Unavailable tRPC adapter | Integration | Live updates continue only when buffering succeeds; failed persistence is observable in metrics/logs and never reported as saved. |
| Rapid collaborative editing | E2E | Two clients see accepted document updates; after shutdown/restart, PostgreSQL contains the latest successfully flushed scene. |

Use fake timers and an injected persistence spy for buffer tests. Keep the E2E
assertion on the rendered scene and process-restart/reload outcome, not on map
internals or timer values.

## Definition of done

- Accepted document updates are projected into validated `BoardSnapshot` values
  and coalesced per `roomId` without synchronous database work in the WebSocket
  handler.
- The buffer has a configurable dirty-room bound; an update that cannot reserve
  capacity is rejected without mutating live room state.
- Debounce, retry, in-flight replacement, empty-room retention, and graceful
  shutdown drain have deterministic unit/integration coverage.
- Production persistence uses the existing web tRPC route and ZenStack-enhanced
  Prisma boundary; `apps/realtime` does not access PostgreSQL directly.
- Loading, explicit Save, and collaboration behavior from Slice 7 remain
  unchanged for the browser; no client success state is inferred from enqueueing.
- Metrics expose pending/dirty room count, flush duration, successful writes,
  retry attempts, terminal failures, and capacity rejections.
- `bun run test:unit`, targeted realtime tests, typecheck, lint, and the relevant
  Playwright collaboration/persistence flow pass.

## Future improvements

- Add a durable outbox or Redis-backed coordinator only after multiple realtime
  processes make the single-process buffer insufficient.
- Add revision/sequence metadata and optimistic concurrency checks if multiple
  persistence writers can race.
- Add operator retry/dead-letter tooling instead of retaining terminal failures
  only in process memory.
- Add a visible autosave state only after the persistence contract and failure
  metrics are stable.

The stable behavior future implementations must preserve is: a validated,
accepted room update is either represented by the newest pending snapshot or has
been durably written; coalescing may remove intermediate snapshots, but it may
not remove the final accepted scene.
