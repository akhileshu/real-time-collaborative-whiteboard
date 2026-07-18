import { healthResponse } from "./health";

const port = Number(process.env.REALTIME_PORT ?? 3001);

Bun.serve({
  port,
  fetch(request) {
    return healthResponse(new URL(request.url).pathname);
  },
});

console.log(`Realtime server listening on http://localhost:${port}`);
