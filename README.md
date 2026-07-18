# Real-time collaborative whiteboard

The project is a Bun workspace with a Next.js web app, a separate Bun
realtime process, and shared transport contracts.

## Development

```sh
bun install
bun run dev
```

The web app runs on `http://localhost:3000`. The realtime health endpoint is
`http://localhost:3001/health`.

## Verification

```sh
bun test
bun run typecheck
bun run lint
bun run build
```

The implementation order is documented in
[`docs/01.implementation-slices.md`](docs/01.implementation-slices.md), with
the workspace ownership decisions in
[`docs/02.repo-Structure.md`](docs/02.repo-Structure.md).
