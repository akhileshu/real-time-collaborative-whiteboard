# Lessons, bugs, and trade-offs

## 2026-07-18 — Bun workspace bootstrap

- The supplied T3 template was a Pages Router admin app, not a workspace. We
  copied it into `apps/web` and removed template-only auth, Prisma, dashboard,
  and example code before installing dependencies.
- `bun run --cwd <dir> <script>` is the working form for package scripts in
  root commands; `bun --cwd <dir> run <script>` was interpreted as CLI usage.
- Keeping every template UI primitive caused a large unnecessary install and
  typecheck surface. Retain only dependencies used by the current slice and
  add UI packages when a later slice needs them.
- The first realtime tracer uses native `Bun.serve` and an in-memory health
  boundary. Defer Elysia, Redis, Yjs, and Prisma until their slices prove the
  need for them.
- Vitest globs must exclude workspace `node_modules`; broad `apps/**/*.test.ts`
  patterns accidentally executed Zod's dependency tests. Scope includes to
  package `src` directories and explicitly exclude `**/node_modules/**`.

## 2026-07-18 — T3 App Router and ZenStack tracer

- The web shell now uses the Next.js App Router and a single tRPC route handler;
  feature-specific server actions and API routes are not part of the boundary.
- `schema.zmodel` is authoritative. ZenStack generates the Prisma schema,
  validation artifacts, and tRPC CRUD routers; generated files must not be
  edited manually.
- ZenStack 2.x with tRPC v10 matches the Prisma-based T3 integration. ZenStack
  3 beta was not used because it replaces Prisma with a different query engine.
- TanStack React Query owns Todo server state; Zustand owns only the Todo UI
  filter. Keeping those stores separate avoids stale duplicated records.
- Bun did not expose the workspace package binaries through `apps/web/.bin` in
  this checkout, so database scripts invoke the local ZenStack and Prisma
  binaries by package path.
- Docker Compose PostgreSQL plus a Playwright create/reload test verified the
  complete Todo persistence path.
- Prisma loads `.env`, not `.env.example`; copy the web environment example
  before running `bun run db:push` or starting the web app.

## 2026-07-18 — Local canvas scene tracer

- The existing root route is the Todo/T3 verification surface, so slice 2 uses
  `/whiteboard` rather than replacing `/`; this keeps the prior smoke test
  stable while adding the canvas boundary.
- The renderer is isolated behind `Scene -> renderScene(context, scene,
  viewport, size)`. Its source is deterministic local data and can later be
  replaced by interaction, WebSocket, or CRDT state without changing drawing.
- Canvas resizing uses `ResizeObserver`, a capped device-pixel ratio, and one
  coalesced `requestAnimationFrame`; cleanup cancels the frame and disconnects
  the observer on unmount.

## 2026-07-18 — Local canvas interaction

- Drag status reports the shape position, so pointer-center tests must preserve
  and account for the initial grab offset.
- Keep `CanvasSurface` browser resources stable while storing the current scene
  in refs; this allows pointer moves to redraw drafts without React renders.

## 2026-07-18 — Realtime room tracer

- Elysia v1 parses JSON WebSocket messages before the `message` callback and
  wraps the raw socket per lifecycle callback. Accept parsed objects at the
  transport edge and key connection state by `ws.raw`, not the wrapper object.
- Keep room fan-out behind `RoomRegistry.members`; it remains deterministic and
  testable even when framework pub/sub wrappers change.
- Existing canvas E2E tests use isolated room IDs because in-memory realtime
  rooms intentionally survive until every client closes.
- Cursor presence stays in a separate registry and is latest-sample-wins; the
  client throttles to 20 updates/second and the overlay updates imperatively.
- All multi-client E2E cases must use unique room IDs. A fixed room can retain
  members from parallel workers and make disconnect-count assertions flaky.

## For dragging shapes **inside a canvas**, Use native Pointer Events insted of `dnd-kit`

No. For dragging shapes **inside a canvas**, `dnd-kit` is usually the wrong abstraction.

Use native Pointer Events:

```text
pointerdown → hit-test shape → setPointerCapture
pointermove → update shape position
pointerup / pointercancel → finish drag
```

`dnd-kit` is better for DOM-based sortable lists, cards, dashboards, and drop zones. Canvas shapes are pixels, not draggable DOM elements, so you need your own hit testing and coordinate conversion anyway.

## 05-live-collaborator-cursors.md new learnings

### Rate limiting and rendering
- Do not queue stale samples. Count samples skipped by the throttle and samples dropped by socket/backpressure conditions.

## 2026-07-19 — Durable board snapshots

- Persist the projected versioned scene as PostgreSQL `jsonb`; keep Yjs update
  internals and cursor presence out of the durable Board model for this slice.
- Load the Board query before opening the realtime room so a saved snapshot can
  seed a new room without allowing a stale database read to replace an active
  Y.Doc.
- The workspace now includes `docker-compose.yml` for the documented local
  PostgreSQL boundary. `apps/web/.env` must exist before `db:generate` or
  `db:push`.
- The first board persistence tracer keeps query/save UI in
  `CollaborativeWhiteboard`; extract a documents feature only when another
  board screen needs the same lifecycle.

## new learnings
- should have used docid insted of room/roomid websocket concept (its just naming preference)
- non goals are also greate when planning next phase roadmap of improvements in this project
- dont transport updates over ws if your are only 1 in that ws room (and there's no one to listen) ?

## 2026-07-19 — Shared document convergence

- The Yjs scene adapter lives in `packages/contracts` so web and realtime share
  one shape encoding/projection implementation.
- A client must initialize its Y.Doc from the server's encoded document state
  before editing; an independent seed can reorder Y.Array inserts when merged.
- The realtime room validates an update against a disposable candidate document
  before mutating the authoritative room document.

## 2026-07-19 — Buffered board snapshot flush

- Reserve dirty-room capacity only after disposable Yjs validation and before
  mutating the authoritative room; this keeps a full persistence buffer from
  silently accepting edits it cannot retain.
- Keep the realtime persistence adapter on the existing web tRPC boundary;
  classify unavailable responses as retryable and never expose database error
  details to WebSocket clients.
- A pending snapshot is independent of room membership, so removing the last
  client must not discard a board write that is waiting to flush.
