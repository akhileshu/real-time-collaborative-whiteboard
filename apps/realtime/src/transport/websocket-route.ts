import { Elysia } from "elysia";
import {
  clientMessageSchema,
  createBoardSnapshot,
  decodeDocumentUpdate,
  encodeDocumentUpdate,
  roomIdSchema,
  type ClientMessage,
  type RoomId,
  type ServerMessage,
} from "@whiteboard/contracts";

import { PresenceRegistry } from "../rooms/presence-registry";
import { RoomRegistry } from "../rooms/room-registry";
import {
  createSnapshotBuffer,
  type SnapshotBuffer,
} from "../persistence/snapshot-buffer";
import {
  createTRPCBoardSnapshotPersistence,
  isRetryablePersistenceError,
} from "../persistence/board-snapshot-persistence";

const MAX_PAYLOAD_LENGTH = 64 * 1024;

export type RealtimeCursorMetrics = {
  invalidMessages: number;
  documentUpdatesReceived: number;
  documentUpdateBytes: number;
  documentApplyFailures: number;
  activeDocuments: number;
  cursorUpdatesReceived: number;
  cursorBroadcasts: number;
  cursorBackpressure: number;
  cursorDropped: number;
  activeCursors: number;
  pendingDirtyRooms: number;
  successfulSnapshotFlushes: number;
  snapshotRetryAttempts: number;
  snapshotTerminalFailures: number;
  snapshotCapacityRejections: number;
  snapshotFlushDurationMs: number;
};

export function createRealtimeCursorMetrics(): RealtimeCursorMetrics {
  return {
    invalidMessages: 0,
    documentUpdatesReceived: 0,
    documentUpdateBytes: 0,
    documentApplyFailures: 0,
    activeDocuments: 0,
    cursorUpdatesReceived: 0,
    cursorBroadcasts: 0,
    cursorBackpressure: 0,
    cursorDropped: 0,
    activeCursors: 0,
    pendingDirtyRooms: 0,
    successfulSnapshotFlushes: 0,
    snapshotRetryAttempts: 0,
    snapshotTerminalFailures: 0,
    snapshotCapacityRejections: 0,
    snapshotFlushDurationMs: 0,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createDefaultSnapshotBuffer(metrics: RealtimeCursorMetrics): SnapshotBuffer {
  return createSnapshotBuffer({
    maxDirtyRooms: positiveInteger(process.env.REALTIME_MAX_DIRTY_ROOMS, 256),
    debounceMs: positiveInteger(process.env.REALTIME_SNAPSHOT_DEBOUNCE_MS, 250),
    maxAttempts: positiveInteger(process.env.REALTIME_SNAPSHOT_MAX_ATTEMPTS, 4),
    retryDelaysMs: [100, 500, 2_000],
    persistence: createTRPCBoardSnapshotPersistence({
      endpoint: process.env.REALTIME_WEB_TRPC_URL ?? "http://127.0.0.1:3000/api/trpc/board.upsert",
    }),
    isRetryable: isRetryablePersistenceError,
    onMetrics: (snapshotMetrics) => {
      metrics.pendingDirtyRooms = snapshotMetrics.pendingRoomCount;
      metrics.successfulSnapshotFlushes = snapshotMetrics.successfulFlushes;
      metrics.snapshotRetryAttempts = snapshotMetrics.retryAttempts;
      metrics.snapshotTerminalFailures = snapshotMetrics.terminalFailures;
      metrics.snapshotFlushDurationMs = snapshotMetrics.flushDurationMs;
    },
  });
}

type ConnectionState = {
  roomId: RoomId;
  clientId: string;
};

function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

function decode(raw: unknown): unknown {
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(raw));
  if (raw instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(raw));
  if (typeof raw === "object" && raw !== null) return raw;
  throw new Error("WebSocket messages must be JSON text or bytes.");
}

function sendProtocolError(
  ws: { send: (message: string) => unknown },
  code: "invalid-message" | "not-joined" | "invalid-operation" | "invalid-document" | "room-unavailable",
  message: string,
): void {
  ws.send(encode({ type: "protocol-error", code, message }));
}

function recordCursorSend(
  result: unknown,
  metrics: RealtimeCursorMetrics,
): void {
  if (typeof result === "number" && result === 0) {
    metrics.cursorDropped += 1;
    return;
  }
  if (typeof result === "number" && result === -1) {
    metrics.cursorBackpressure += 1;
    return;
  }
  metrics.cursorBroadcasts += 1;
}

function parseClientMessage(raw: unknown):
  | { ok: true; value: ClientMessage }
  | { ok: false; message: string } {
  try {
    const parsed = clientMessageSchema.safeParse(decode(raw));
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: "Message does not match the room protocol." };
  } catch {
    return { ok: false, message: "Message must be valid JSON." };
  }
}

export function createRealtimeApp(
  registry = new RoomRegistry(),
  presence = new PresenceRegistry(),
  metrics = createRealtimeCursorMetrics(),
  snapshotBuffer = createDefaultSnapshotBuffer(metrics),
) {
  const states = new WeakMap<object, ConnectionState>();
  const socketKey = (ws: object): object => {
    return (ws as { raw?: object }).raw ?? ws;
  };

  return new Elysia().ws("/ws/:roomId", {
    maxPayloadLength: MAX_PAYLOAD_LENGTH,
    idleTimeout: 60,
    open(ws) {
      const roomId = roomIdSchema.safeParse(ws.data.params.roomId);
      if (!roomId.success) {
        sendProtocolError(ws, "room-unavailable", "The room ID is invalid.");
        ws.close(1008, "Invalid room ID");
      }
    },
    message(ws, rawMessage) {
      const parsed = parseClientMessage(rawMessage);
      if (!parsed.ok) {
        metrics.invalidMessages += 1;
        sendProtocolError(ws, "invalid-message", parsed.message);
        return;
      }

      const roomIdResult = roomIdSchema.safeParse(ws.data.params.roomId);
      if (!roomIdResult.success) {
        sendProtocolError(ws, "room-unavailable", "The room ID is invalid.");
        return;
      }
      const roomId = roomIdResult.data;
      const state = states.get(socketKey(ws));

      if (parsed.value.type === "join") {
        if (state) {
          sendProtocolError(ws, "invalid-message", "This connection already joined a room.");
          return;
        }

        const joined = registry.join(
          roomId,
          {
            clientId: parsed.value.clientId,
            send: (message) => ws.send(encode(message)),
          },
          parsed.value.initialScene,
        );
        if (!joined.ok) {
          sendProtocolError(
            ws,
            "room-unavailable",
            joined.code === "room-full"
              ? "The room is full."
              : "That client is already in the room.",
          );
          return;
        }

        states.set(socketKey(ws), { roomId, clientId: parsed.value.clientId });
        presence.join(roomId, parsed.value.clientId);
        ws.send(encode({
          type: "joined",
          roomId,
          clientId: parsed.value.clientId,
          revision: joined.snapshot.revision,
        }));
        ws.send(encode({
          type: "room-state",
          scene: [...joined.snapshot.scene],
          revision: joined.snapshot.revision,
          memberCount: joined.snapshot.memberCount,
        }));
        ws.send(encode({
          type: "document-state",
          update: encodeDocumentUpdate(joined.snapshot.documentState),
        }));
        metrics.activeDocuments = registry.roomCount();
        ws.send(encode({
          type: "presence-state",
          cursors: presence.snapshot(roomId, parsed.value.clientId),
        }));
        const joinedStatus = {
          type: "room-status",
          memberCount: joined.snapshot.memberCount,
        } as const;
        for (const member of registry.members(roomId, parsed.value.clientId)) {
          member.send(joinedStatus);
        }
        return;
      }

      if (!state) {
        sendProtocolError(ws, "not-joined", "Join the room before sending messages.");
        return;
      }

      if (parsed.value.type === "cursor") {
        metrics.cursorUpdatesReceived += 1;
        if (parsed.value.point === null) {
          if (!presence.removeCursor(state.roomId, state.clientId)) return;
          metrics.activeCursors = presence.activeCursorCount();

          const hiddenMessage = {
            type: "cursor-hidden",
            clientId: state.clientId,
          } as const;
          for (const member of registry.members(state.roomId, state.clientId)) {
            recordCursorSend(member.send(hiddenMessage), metrics);
          }
          return;
        }

        if (!presence.putCursor(state.roomId, state.clientId, parsed.value.point)) {
          sendProtocolError(ws, "not-joined", "Join the room before sending cursor updates.");
          return;
        }
        metrics.activeCursors = presence.activeCursorCount();

        const cursorMessage = {
          type: "cursor",
          clientId: state.clientId,
          point: parsed.value.point,
        } as const;
        for (const member of registry.members(state.roomId, state.clientId)) {
          recordCursorSend(member.send(cursorMessage), metrics);
        }
        return;
      }

      if (parsed.value.type === "document-update") {
        metrics.documentUpdatesReceived += 1;
        let update: Uint8Array;
        try {
          update = decodeDocumentUpdate(parsed.value.update);
        } catch {
          metrics.documentApplyFailures += 1;
          sendProtocolError(ws, "invalid-document", "The document update is not valid base64.");
          return;
        }
        metrics.documentUpdateBytes += update.byteLength;
        if (update.byteLength > 48 * 1024) {
          metrics.documentApplyFailures += 1;
          sendProtocolError(ws, "invalid-document", "The document update is too large.");
          return;
        }

        let acceptedSnapshot: ReturnType<typeof createBoardSnapshot> | null = null;
        const applied = registry.applyUpdate(
          state.roomId,
          state.clientId,
          update,
          (candidateScene) => {
            try {
              acceptedSnapshot = createBoardSnapshot([...candidateScene]);
            } catch {
              return {
                ok: false as const,
                code: "invalid-document" as const,
                message: "The document snapshot exceeds persistence limits.",
              };
            }
            return snapshotBuffer.reserve(roomId);
          },
        );
        if (!applied.ok) {
          if (applied.code === "persistence-capacity") {
            metrics.snapshotCapacityRejections += 1;
          }
          metrics.documentApplyFailures += 1;
          const errorCode = applied.code === "not-member"
            ? "not-joined"
            : applied.code === "persistence-capacity"
              ? "room-unavailable"
              : "invalid-document";
          sendProtocolError(ws, errorCode, applied.message);
          return;
        }

        if (acceptedSnapshot) {
          snapshotBuffer.enqueue({ roomId, snapshot: acceptedSnapshot });
        }

        for (const member of registry.members(state.roomId, state.clientId)) {
          member.send({ type: "document-update", update: parsed.value.update });
        }
        return;
      }

      sendProtocolError(
        ws,
        "invalid-document",
        "Legacy scene operations are not accepted; send a document update.",
      );
    },
    close(ws) {
      const state = states.get(socketKey(ws));
      if (!state) return;

      const cursorWasVisible = presence.leave(state.roomId, state.clientId);
      registry.leave(state.roomId, state.clientId);
      states.delete(socketKey(ws));
      metrics.activeDocuments = registry.roomCount();
      if (cursorWasVisible) {
        metrics.activeCursors = presence.activeCursorCount();
        const hiddenMessage = {
          type: "cursor-hidden",
          clientId: state.clientId,
        } as const;
        for (const member of registry.members(state.roomId)) {
          recordCursorSend(member.send(hiddenMessage), metrics);
        }
      }
      const snapshot = registry.snapshot(state.roomId);
      if (snapshot) {
        const statusMessage = {
          type: "room-status",
          memberCount: snapshot.memberCount,
        } as const;
        for (const member of registry.members(state.roomId)) {
          member.send(statusMessage);
        }
      }
    },
  });
}

export function createRealtimeRuntime() {
  const metrics = createRealtimeCursorMetrics();
  const snapshotBuffer = createDefaultSnapshotBuffer(metrics);
  const app = createRealtimeApp(
    new RoomRegistry(),
    new PresenceRegistry(),
    metrics,
    snapshotBuffer,
  );
  return { app, metrics, snapshotBuffer };
}

export { parseClientMessage };
