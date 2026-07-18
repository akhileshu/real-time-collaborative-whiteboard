# requirements + acceptance tests

## Real-Time Collaborative Whiteboard (Figma/Miro Clone)
Instead of a basic document editor, build a real-time multiplayer canvas where users can draw, move shapes, and see each other's cursors.

* **The Tech Stack:** Next.js (Frontend), Bun + Elysia or Fastify (Websocket Server), Prisma + PostgreSQL (Data persistence), Redis (Pub/Sub for syncing user presence).
* **Why it showcases engineering depth:** * **State Synchronization:** You have to handle conflict resolution (e.g., using **CRDTs** like Yjs) so two users editing the same shape doesn't crash the UI.
    * **Performance Optimization:** Rendering hundreds of moving shapes and cursors on a Canvas/SVG without tanking the browser's framerate.
    * **Hybrid Backend:** Combining standard HTTP APIs for saving files with persistent WebSocket connections for live editing.


