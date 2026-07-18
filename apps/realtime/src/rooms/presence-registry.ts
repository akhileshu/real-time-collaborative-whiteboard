import type { ClientId, RoomId, ScenePoint } from "@whiteboard/contracts";

export type CursorPresence = {
  clientId: ClientId;
  point: ScenePoint;
};

type PresenceRoom = {
  members: Set<ClientId>;
  cursors: Map<ClientId, ScenePoint>;
};

export class PresenceRegistry {
  private readonly rooms = new Map<RoomId, PresenceRoom>();

  join(roomId: RoomId, clientId: ClientId): void {
    const room = this.rooms.get(roomId) ?? { members: new Set(), cursors: new Map() };
    room.members.add(clientId);
    this.rooms.set(roomId, room);
  }

  putCursor(roomId: RoomId, clientId: ClientId, point: ScenePoint): boolean {
    const room = this.rooms.get(roomId);
    if (!room?.members.has(clientId)) return false;
    room.cursors.set(clientId, point);
    return true;
  }

  removeCursor(roomId: RoomId, clientId: ClientId): boolean {
    return this.rooms.get(roomId)?.cursors.delete(clientId) ?? false;
  }

  leave(roomId: RoomId, clientId: ClientId): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const hadCursor = room.cursors.delete(clientId);
    room.members.delete(clientId);
    if (room.members.size === 0) this.rooms.delete(roomId);
    return hadCursor;
  }

  snapshot(roomId: RoomId, excludingClientId?: ClientId): CursorPresence[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.cursors.entries())
      .filter(([clientId]) => clientId !== excludingClientId)
      .map(([clientId, point]) => ({ clientId, point }));
  }

  activeCursorCount(): number {
    let count = 0;
    for (const room of Array.from(this.rooms.values())) count += room.cursors.size;
    return count;
  }
}
