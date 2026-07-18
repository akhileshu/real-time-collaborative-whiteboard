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
