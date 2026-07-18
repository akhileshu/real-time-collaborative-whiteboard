import {
  clientIdSchema,
  encodeDocumentUpdate,
  decodeDocumentUpdate,
  serverMessageSchema,
  type SceneOperation,
  type ScenePoint,
  type ServerMessage,
  type WireShape,
} from "@whiteboard/contracts";
import { z } from "zod";

import { createCursorSender, type CursorSenderStats } from "./cursor-sender";

export const realtimeUrlSchema = z
  .string()
  .regex(/^wss?:\/\//, "Realtime URL must use ws:// or wss://.");

export type RoomConnectionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; revision: number; memberCount: number }
  | { kind: "closed"; reason: string };

export type RoomConnectionEvents = {
  onState: (state: RoomConnectionState) => void;
  onRoomState: (message: Extract<ServerMessage, { type: "room-state" }>) => void;
  onOperation: (message: Extract<ServerMessage, { type: "operation" }>) => void;
  onDocumentState: (update: Uint8Array) => void;
  onDocumentUpdate: (update: Uint8Array) => void;
  onRoomStatus: (message: Extract<ServerMessage, { type: "room-status" }>) => void;
  onPresenceState: (message: Extract<ServerMessage, { type: "presence-state" }>) => void;
  onCursor: (message: Extract<ServerMessage, { type: "cursor" }>) => void;
  onCursorHidden: (message: Extract<ServerMessage, { type: "cursor-hidden" }>) => void;
  onProtocolError: (message: Extract<ServerMessage, { type: "protocol-error" }>) => void;
};

type SocketLike = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send: (message: string) => void;
  close: () => void;
};

type RoomConnectionOptions = {
  url: string;
  roomId: string;
  clientId: string;
  initialScene: readonly WireShape[];
  events: RoomConnectionEvents;
  socketFactory?: (url: string) => SocketLike;
};

const SOCKET_OPEN = 1;

export function readRealtimeUrl(value: string): string {
  return realtimeUrlSchema.parse(value);
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = serverMessageSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createRoomConnection({
  url,
  roomId,
  clientId,
  initialScene,
  events,
  socketFactory = (socketUrl) => new WebSocket(socketUrl),
}: RoomConnectionOptions) {
  const parsedClientId = clientIdSchema.parse(clientId);
  let socket: SocketLike | null = null;
  let closedByOwner = false;
  const cursorSender = createCursorSender((point) => {
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(JSON.stringify({ type: "cursor", point }));
      return true;
    } catch {
      return false;
    }
  });

  const connect = () => {
    events.onState({ kind: "connecting" });
    socket = socketFactory(`${readRealtimeUrl(url)}/ws/${encodeURIComponent(roomId)}`);
    socket.onopen = () => {
      socket?.send(JSON.stringify({
        type: "join",
        clientId: parsedClientId,
        initialScene: [...initialScene],
      }));
    };
    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (!message) {
        events.onState({ kind: "closed", reason: "Received an invalid room message." });
        socket?.close();
        return;
      }

      if (message.type === "room-state") {
        events.onState({
          kind: "connected",
          revision: message.revision,
          memberCount: message.memberCount,
        });
        events.onRoomState(message);
      } else if (message.type === "document-state") {
        try {
          events.onDocumentState(decodeDocumentUpdate(message.update));
        } catch {
          events.onState({ kind: "closed", reason: "Received an invalid document state." });
          socket?.close();
        }
      } else if (message.type === "document-update") {
        try {
          events.onDocumentUpdate(decodeDocumentUpdate(message.update));
        } catch {
          events.onState({ kind: "closed", reason: "Received an invalid document update." });
          socket?.close();
        }
      } else if (message.type === "operation") {
        events.onOperation(message);
      } else if (message.type === "room-status") {
        events.onRoomStatus(message);
      } else if (message.type === "presence-state") {
        events.onPresenceState(message);
      } else if (message.type === "cursor") {
        events.onCursor(message);
      } else if (message.type === "cursor-hidden") {
        events.onCursorHidden(message);
      } else if (message.type === "protocol-error") {
        events.onProtocolError(message);
      }
    };
    socket.onerror = () => {
      events.onState({ kind: "closed", reason: "Unable to connect to the room." });
    };
    socket.onclose = () => {
      if (!closedByOwner) {
        events.onState({ kind: "closed", reason: "Disconnected from the room." });
      }
    };
  };

  return {
    connect,
    sendOperation(operation: SceneOperation, revision: number): boolean {
      if (!socket || socket.readyState !== SOCKET_OPEN) return false;
      socket.send(JSON.stringify({ type: "operation", operation, revision }));
      return true;
    },
    sendDocumentUpdate(update: Uint8Array): boolean {
      if (!socket || socket.readyState !== SOCKET_OPEN) return false;
      socket.send(JSON.stringify({
        type: "document-update",
        update: encodeDocumentUpdate(update),
      }));
      return true;
    },
    sendCursor(point: ScenePoint | null): boolean {
      return cursorSender.send(point);
    },
    getCursorStats(): CursorSenderStats {
      return { ...cursorSender.stats };
    },
    close() {
      closedByOwner = true;
      cursorSender.close();
      socket?.close();
      socket = null;
    },
  };
}
