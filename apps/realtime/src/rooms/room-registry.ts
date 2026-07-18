import type {
  RoomId,
  SceneOperation,
  ServerMessage,
  WireShape,
} from "@whiteboard/contracts";
import {
  createSharedDocument,
  createSharedDocumentFromState,
  type SharedDocument,
} from "@whiteboard/contracts";

import { applySceneOperation } from "./operations";

const MAX_SEEN_OPERATION_IDS = 10_000;
const MAX_ROOM_MEMBERS = 32;

export type RoomMember = {
  clientId: string;
  send: (message: ServerMessage) => unknown;
};

export type RoomSnapshot = {
  scene: readonly WireShape[];
  revision: number;
  memberCount: number;
  documentState: Uint8Array;
};

type Room = {
  roomId: RoomId;
  scene: readonly WireShape[];
  revision: number;
  members: Map<string, RoomMember>;
  seenOperationIds: Set<string>;
  document: SharedDocument;
};

export type JoinResult =
  | { ok: true; snapshot: RoomSnapshot }
  | { ok: false; code: "duplicate-client" | "room-full" };

export type ApplyResult =
  | {
      ok: true;
      scene: readonly WireShape[];
      operation: SceneOperation;
      revision: number;
    }
  | {
      ok: false;
      code: "not-member" | "duplicate-operation" | "invalid-operation";
      message: string;
  };

export type DocumentApplyResult =
  | { ok: true; scene: readonly WireShape[]; revision: number }
  | { ok: false; code: "not-member" | "invalid-document" | "persistence-capacity"; message: string };

export type DocumentAdmission = (
  scene: readonly WireShape[],
) => boolean | { ok: true } | { ok: false; code: "persistence-capacity" | "invalid-document"; message: string };

export class RoomRegistry {
  private readonly rooms = new Map<RoomId, Room>();

  join(roomId: RoomId, member: RoomMember, initialScene: readonly WireShape[]): JoinResult {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        scene: [...initialScene],
        revision: 0,
        members: new Map(),
        seenOperationIds: new Set(),
        document: createSharedDocument(initialScene),
      };
      this.rooms.set(roomId, room);
    }

    if (room.members.has(member.clientId)) {
      return { ok: false, code: "duplicate-client" };
    }
    if (room.members.size >= MAX_ROOM_MEMBERS) {
      return { ok: false, code: "room-full" };
    }

    room.members.set(member.clientId, member);
    return { ok: true, snapshot: this.toSnapshot(room) };
  }

  applyUpdate(
    roomId: RoomId,
    clientId: string,
    update: Uint8Array,
    admit?: DocumentAdmission,
  ): DocumentApplyResult {
    const room = this.rooms.get(roomId);
    if (!room || !room.members.has(clientId)) {
      return {
        ok: false,
        code: "not-member",
        message: "The document update sender is not a member of this room.",
      };
    }

    const candidate = createSharedDocumentFromState(room.document.encodeState());
    const valid = candidate.applyUpdate(update);
    if (!valid) {
      candidate.destroy();
      return {
        ok: false,
        code: "invalid-document",
        message: "The document update does not produce a valid scene.",
      };
    }
    const candidateScene = candidate.scene;
    candidate.destroy();

    if (admit) {
      const admission = admit(candidateScene);
      if (admission === false) {
        return {
          ok: false,
          code: "persistence-capacity",
          message: "The persistence buffer is full; retry the document update.",
        };
      }
      if (typeof admission === "object" && !admission.ok) return admission;
    }

    if (!room.document.applyUpdate(update)) {
      return {
        ok: false,
        code: "invalid-document",
        message: "The document update could not be applied.",
      };
    }
    room.scene = room.document.scene;
    room.revision += 1;
    return { ok: true, scene: room.scene, revision: room.revision };
  }

  apply(roomId: RoomId, clientId: string, operation: SceneOperation): ApplyResult {
    const room = this.rooms.get(roomId);
    if (!room || !room.members.has(clientId) || operation.clientId !== clientId) {
      return {
        ok: false,
        code: "not-member",
        message: "The operation sender is not a member of this room.",
      };
    }

    if (room.seenOperationIds.has(operation.operationId)) {
      return {
        ok: false,
        code: "duplicate-operation",
        message: "The operation was already accepted by this room.",
      };
    }

    const applied = applySceneOperation(room.scene, operation);
    if (!applied.ok) return applied;

    room.scene = applied.scene;
    room.revision += 1;
    room.seenOperationIds.add(operation.operationId);
    if (room.seenOperationIds.size > MAX_SEEN_OPERATION_IDS) {
      const oldest = room.seenOperationIds.values().next().value;
      if (oldest) room.seenOperationIds.delete(oldest);
    }

    return {
      ok: true,
      scene: room.scene,
      operation,
      revision: room.revision,
    };
  }

  members(roomId: RoomId, excludingClientId?: string): RoomMember[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.members.values()).filter(
      (member) => member.clientId !== excludingClientId,
    );
  }

  leave(roomId: RoomId, clientId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.members.delete(clientId);
    if (room.members.size === 0) {
      room.document.destroy();
      this.rooms.delete(roomId);
    }
  }

  snapshot(roomId: RoomId): RoomSnapshot | null {
    const room = this.rooms.get(roomId);
    return room ? this.toSnapshot(room) : null;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  private toSnapshot(room: Room): RoomSnapshot {
    return {
      scene: room.scene,
      revision: room.revision,
      memberCount: room.members.size,
      documentState: room.document.encodeState(),
    };
  }
}
