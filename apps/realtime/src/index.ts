import { healthResponse } from "./health";
import { createShutdown } from "./shutdown";
import { createRealtimeRuntime } from "./transport/websocket-route";

export function createApp() {
  return createRealtimeRuntime().app.get("/health", ({ request }) =>
    healthResponse(new URL(request.url).pathname),
  );
}

export function startRealtimeServer(port = Number(process.env.REALTIME_PORT ?? 3001)) {
  const runtime = createRealtimeRuntime();
  const app = runtime.app.get("/health", ({ request }) =>
    healthResponse(new URL(request.url).pathname),
  ).listen(port, ({ hostname, port: listeningPort }) => {
    console.log(`Realtime server listening on http://${hostname}:${listeningPort}`);
  });

  const stop = createShutdown({
    drain: () => runtime.snapshotBuffer.drain(),
    stop: () => app.stop(),
  });
  process.once("SIGTERM", () => void stop().catch((error) => {
    process.exitCode = 1;
    console.error("SIGTERM: board snapshots did not drain", error);
  }));
  process.once("SIGINT", () => void stop().catch((error) => {
    process.exitCode = 1;
    console.error("SIGINT: board snapshots did not drain", error);
  }));

  return app;
}

if (import.meta.main) startRealtimeServer();
