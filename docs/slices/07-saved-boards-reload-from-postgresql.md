# Slice 7 — Saved Boards Reload from PostgreSQL

## What To Study

1. [Prisma PostgreSQL connector](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql) — Prisma ORM documentation.
   Read PostgreSQL scalar mappings, especially `Json` to `jsonb`; this informs
   storing a validated scene snapshot rather than database rows per canvas draw.
2. [Prisma JSON fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields) — Prisma ORM documentation.
   Read JSON read/write behavior and supported values; this informs the
   versioned snapshot envelope and server-side size/shape validation.
3. [Prisma transactions and batch queries](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) — Prisma ORM documentation.
   Read atomic mutation behavior; this informs the single-board upsert boundary
   and the decision not to add a multi-table transaction yet.
4. [ZenStack documentation](https://zenstack.dev/docs) — ZenStack maintainers.
   Read schema-first modeling, access policies, and generated query services;
   this preserves `schema.zmodel` as the source of truth and reuses generated
   tRPC CRUD rather than adding an HTTP adapter.
5. [Yjs Document Updates](https://docs.yjs.dev/api/document-updates) — Yjs maintainers.
   Read encoded state updates and document projection; this informs the
   boundary where a live Y.Doc becomes a durable, renderer-compatible scene
   snapshot without persisting ephemeral cursor state.

## Goal

An unauthenticated board user can explicitly save the current scene for a room,
reload `/whiteboard?room=<id>`, and see the saved rectangle/circle scene before
joining realtime collaboration. The board metadata and latest validated scene
survive a web/realtime process restart through PostgreSQL.

The smallest successful path is:

```text
live Y.Doc projection
    -> Save board interaction
    -> shared snapshot schema
    -> generated tRPC Board upsert
    -> ZenStack-enhanced Prisma
    -> PostgreSQL jsonb snapshot

room query
    -> generated tRPC Board findUnique
    -> snapshot validation/projection
    -> realtime room join initial scene
    -> Y.Doc seed/document-state
    -> CanvasSurface render
```

## Non-goals

- No revision history, autosave, background flush, retry queue, conflict merge,
  or last-write-wins UI beyond the explicit save action.
- No authentication, ownership, sharing permissions, or forbidden board state;
  the current project specification is unauthenticated.
- No separate `BoardShape` rows, search/indexing of individual shapes, or
  database persistence of cursors/presence messages.
- No PostgreSQL access from `apps/realtime`; the web tRPC/ZenStack boundary is
  the only application data adapter.
- No persistence of raw Yjs update logs or Y.Doc internals. Store a versioned
  JSON scene snapshot so it remains inspectable and independent of CRDT
  implementation details.
- No new API route, server action, Redis dependency, or background worker.

## Design

### Core mental model

```text
Board query
    -> runtime snapshot validation
    -> loading/empty/error state
    -> room connection receives persisted initial scene
    -> realtime Y.Doc remains live authority
    -> canvas renders the current scene

Save click
    -> disable duplicate save
    -> project current live scene
    -> validate versioned snapshot
    -> generated Board.upsert tRPC procedure
    -> ZenStack policy + enhanced Prisma
    -> PostgreSQL jsonb
    -> invalidate Board.findUnique cache
    -> show saved timestamp/status
```

### Data truth and authority

Add a `Board` model to `apps/web/schema.zmodel`; the generated Prisma schema and
routers remain derived artifacts and must not be hand-edited:

```zmodel
model Board {
  id        String   @id @default(cuid())
  roomId    String   @unique
  name      String   @default("Untitled board")
  snapshot  Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@allow('all', true)
}
```

`roomId` is the stable lookup key. `snapshot` is a JSON envelope, not an
untyped scene value:

```ts
type BoardSnapshot = {
  version: 1;
  scene: readonly WireShape[];
};
```

The live realtime room remains authoritative while connected. A saved board is
the durable seed used when a room has no live document yet; an active room
continues to ignore later join seeds and sends its current Y.Doc state. This
prevents a stale database read from overwriting active collaborators.

The server-side tRPC boundary owns authorization (currently the explicit
public policy), runtime input validation, snapshot size limits, and persistence.
The client may disable Save while loading or saving, but it is not the policy
engine and must not claim a save until the mutation succeeds.

### Snapshot validation and size

Keep one shared Zod schema for the snapshot envelope and reuse the existing
`wireShapeSchema` limits. Validate on both the tRPC input boundary and when
mapping loaded JSON into the realtime join seed. Reject snapshots over the
configured scene count and serialized byte limit before database write or room
join. The first version can use a conservative 1 MiB serialized snapshot cap;
measure actual board sizes before raising it.

The snapshot is deliberately a projection of the Y.Doc rather than an encoded
Yjs update. This keeps PostgreSQL storage independent of CRDT internals and
preserves the stable `Scene` renderer contract. A later persistence slice may
store encoded Yjs state or update logs behind a new migration if offline/replay
requirements justify it.

### Loading and client state

`CollaborativeWhiteboard` owns the visible persistence lifecycle:

- `board.findUnique({ where: { roomId } })` loads one board before opening the
  room connection.
- No board means use the existing deterministic scene as the first-room seed;
  do not write a row merely by viewing a room.
- A valid board snapshot becomes `initialScene` for the room connection. The
  realtime server remains authoritative if the room already exists.
- Query data stays in TanStack Query. The live scene stays in the existing
  Y.Doc adapter/component state, not Zustand.
- Save reads the latest projected scene from a ref/state boundary, preserving
  the user's current edits while the mutation is in flight.

### Repository and feature ownership

```text
apps/web/
├── schema.zmodel                         # Board model and current public policy
├── src/server/api/routers/generated/     # Generated Board CRUD; regenerate
├── src/features/collaboration/
│   └── collaborative-whiteboard.tsx      # Query/save lifecycle + room seed
└── prisma/schema.prisma                  # Generated; never hand-edit

packages/contracts/src/
└── board-snapshot.ts                     # Canonical snapshot Zod schema/types

tests/e2e/
└── whiteboard-persistence.spec.ts        # Save, reload, and failure behavior
```

Use the existing App Router tRPC adapter at
`src/app/api/trpc/[trpc]/route.ts`. Reuse generated `Board.findUnique` and
`Board.upsert` procedures, TanStack Query invalidation, the existing providers,
and the existing accessible status pattern. Do not add a board REST route or a
feature-specific server action.

Repository constraint: this checkout has `DATABASE_URL` and database scripts,
but no root `docker-compose.yml` was present during design. Before
implementation verification, restore/add the project-local PostgreSQL Compose
service or document the equivalent approved local service; do not silently
replace the required PostgreSQL boundary with an in-memory database.

## Interfaces

### Shared snapshot contract

The shared contract owns runtime validation for untrusted JSON crossing the
browser/server boundary. `WireShape` remains the source type for the canvas
scene and is converted to the local `Scene` only at the feature boundary.

```ts
import { z } from "zod";
import { wireShapeSchema } from "./document-operations";

export const boardSnapshotSchema = z.object({
  version: z.literal(1),
  scene: z.array(wireShapeSchema).max(10_000),
}).strict();

export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

export function parseBoardSnapshot(value: unknown): BoardSnapshot {
  const parsed = boardSnapshotSchema.parse(value);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (bytes > 1_048_576) throw new Error("Board snapshot is too large.");
  return parsed;
}
```

The generated ZenStack Board procedures provide typed transport and database
validation for the model shape. The snapshot schema must still be applied at
the application boundary before `upsert`, and loaded data must be parsed before
it becomes a room seed. The server remains authoritative for acceptance and
the client renders the returned board/result.

### Generated tRPC request shapes

Reuse generated CRUD contracts rather than inventing a second endpoint:

```ts
type FindBoardInput = {
  where: { roomId: string };
};

type UpsertBoardInput = {
  where: { roomId: string };
  create: {
    roomId: string;
    name: string;
    snapshot: BoardSnapshot;
  };
  update: {
    name?: string;
    snapshot: BoardSnapshot;
  };
};
```

The exact generated JSON input type may require the repository's Prisma JSON
value type rather than `BoardSnapshot`; use a typed mapping at the feature
boundary and do not cast arbitrary values through the router. Keep `roomId`
validated with the existing `roomIdSchema`, and constrain `name` to a small
non-empty Zod string if a name control is exposed.

### Classified persistence errors

```ts
type BoardPersistenceError =
  | { kind: "validation"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "unavailable"; message: string };
```

Map generated tRPC/ZenStack errors into user-visible states at the feature
boundary. Do not expose Prisma error codes or claim that an optimistic local
scene is durable.

### Query and mutation keys

Use the generated hook keys:

```ts
const boardQuery = api.board.findUnique.useQuery({
  where: { roomId },
});

const saveBoard = api.board.upsert.useMutation({
  onSuccess: async () => {
    await utils.board.findUnique.invalidate({ where: { roomId } });
  },
});
```

Do not duplicate the persisted board in Zustand. The room's live Y.Doc remains
separate from the query cache; invalidation refreshes metadata/snapshot after a
successful save but does not replace a currently connected live room.

### Component inputs and events

```ts
type BoardPersistenceProps = {
  roomId: string;
  currentScene: Scene;
  onInitialScene: (scene: Scene) => void;
  onStatus: (status: "loading" | "ready" | "saving" | "saved" | "error") => void;
};

type SaveBoardButtonProps = {
  disabled: boolean;
  onClick: () => void;
};
```

The Save control is keyboard accessible, disabled during loading/saving, and
has a live status such as `Loading saved board…`, `No saved board yet`, `Saving
board…`, `Board saved`, or `Could not save board. Try again.`

## Execution flow

### Load and join

1. Validate the URL room ID with the existing `roomIdSchema`.
2. Query `Board.findUnique` through the tRPC React Query hook.
3. While loading, show the persistence status and keep editing controls
   disabled; do not open a realtime connection with an unknown seed.
4. If no board exists, use the current deterministic initial scene. If a board
   exists, parse `snapshot`, project it to `Scene`, and use it as the initial
   room seed.
5. Open the existing WebSocket room connection. The realtime process seeds a
   new room from this scene and remains authoritative for the live Y.Doc.
6. On malformed persisted data, show a load error and a retry action; do not
   join the room or silently fall back to a different scene.

### Save

```text
idle
  -> saving (disable duplicate save; preserve live scene)
  -> saved (show timestamp; invalidate Board.findUnique)
  -> validation-error (keep scene; show actionable message)
  -> unavailable (keep scene; offer retry; no success claim)
```

1. User activates Save.
2. Capture the latest projected live `Scene`, build `{ version: 1, scene }`,
   and parse it with `boardSnapshotSchema` plus the serialized-size limit.
3. Call generated `Board.upsert` using `roomId` as the unique selector. The
   generated ZenStack policy and enhanced Prisma client remain the server data
   boundary.
4. On success, invalidate the single-board query, update the saved status, and
   leave the live Y.Doc/canvas untouched.
5. On failure, preserve the current scene and form/UI state; re-enable Save and
   offer retry. Do not roll back live collaboration for a failed snapshot.

### Database truth -> UI

`PostgreSQL Board.snapshot (jsonb) -> generated ZenStack Board query -> tRPC
React Query cache -> validated feature view model -> initial room seed/live
Y.Doc -> projected Scene -> CanvasSurface and save status`.

No subscription, optimistic cache write, or background persistence is needed in
this low-frequency explicit-save slice. Cleanup only needs the existing room
connection/Y.Doc teardown when the board route unmounts.

## Failure cases

- Invalid room ID: show an invalid-room state and do not query or connect.
- Query loading: show loading status and disabled editing/save controls; no
  connection is opened against an unknown persisted state.
- Board not found: show the deterministic empty/new-board state and allow Save.
- Malformed or oversized database JSON: show `Saved board could not be loaded`,
  preserve no untrusted scene, and offer retry; do not claim the board is ready.
- PostgreSQL/tRPC query failure: show retryable load feedback and keep editing
  disabled until the seed decision is known.
- Save validation failure: preserve the live scene and show the size/shape
  reason; no mutation is sent.
- Save network/server failure: preserve the live scene and last successful
  cache, re-enable Save, and show retryable feedback.
- Concurrent live edits during Save: the captured snapshot represents the
  scene at submit time; later live edits remain visible. The user can save
  again. No revision conflict is claimed in this slice.
- Two explicit saves racing: disable the control per client; server upsert
  order determines the latest persisted snapshot. Revision checks are deferred.
- Realtime room already active with a newer scene: the room's Y.Doc wins over
  the stale database seed for connected clients; Save can persist the newer
  scene explicitly.
- PostgreSQL unavailable during load/save: show unavailable state, preserve
  local live state where present, and never report durability.

## Tests

| Scenario | Level | Expected observable behavior |
|---|---|---|
| Board model and generated CRUD regenerate | Schema/integration | PostgreSQL contains a Board row with room key, metadata, JSON snapshot, and timestamps |
| Valid snapshot save | tRPC/UI integration | Save succeeds, status announces success, and the query cache invalidates |
| Reload saved board | Playwright | A fresh page for the same room renders the saved scene before/after room synchronization |
| No saved board | Playwright | New-board state is clear and Save can create the first snapshot |
| Invalid snapshot shape/version/size | Schema/server integration | Mutation is rejected; no row is written and the UI shows actionable feedback |
| Query failure or malformed stored snapshot | Integration/UI | Editing is not falsely marked ready; retry feedback is visible |
| Save failure | Integration/UI | Current scene remains visible, Save is re-enabled, and no success message appears |
| Active room with stale database snapshot | Realtime/E2E | Existing live room scene remains authoritative after another client joins |
| Existing Todo tracer | Playwright regression | Todo create/reload still works through the generated tRPC boundary |

Use accessible role/name selectors and the existing scene description list for
browser assertions. Do not assert Prisma calls, React Query internals, or JSON
column implementation details in E2E tests.

## Definition of done

- [x] `schema.zmodel` defines a versioned Board snapshot model with a unique
  `roomId`, metadata, timestamps, and the current explicit public policy.
- [x] ZenStack artifacts are regenerated; the generated Board CRUD surface is
  exposed through the existing single tRPC route.
- [x] Shared Zod validation accepts only the supported snapshot version, shape
  variants, count limit, and serialized-size limit.
- [x] Loading a valid saved board seeds a new realtime room; an active room's
  live Y.Doc remains authoritative.
- [x] The UI has explicit loading, new/empty, ready, saving, saved, malformed,
  forbidden, and retryable failure states.
- [x] Save disables duplicate submissions, persists the current scene, and
  invalidates only the affected board query on success.
- [x] PostgreSQL verification proves save, reload, and scene equality; no
  cursor/presence data is persisted.
- [x] Existing Todo CRUD and whiteboard collaboration E2E workflows remain
  green.
- [x] `bun run db:generate`, `bun run db:push`, `bun run test:unit`,
  `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run test:e2e`
  pass with `apps/web/.env` present and PostgreSQL available.

## Future improvements

- Add authenticated ownership and board permissions before making saved boards
  multi-tenant or externally shareable.
- Add optimistic concurrency with a snapshot revision/ETag so two saves cannot
  silently overwrite one another.
- Add autosave/debounced persistence in Slice 8 through a bounded dirty-board
  buffer; preserve this slice's explicit-save behavior as the fallback.
- Persist encoded Yjs state or append-only updates if offline replay or CRDT
  state-vector synchronization requires more than a projected scene snapshot.
- Add board naming/editing, revision history, soft deletion, retention, and
  storage quotas after the basic durable path is measured.
