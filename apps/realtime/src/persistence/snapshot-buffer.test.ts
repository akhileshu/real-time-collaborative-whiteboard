import { describe, expect, it, vi } from "vitest";

import type { BoardSnapshot, RoomId } from "@whiteboard/contracts";

import { createSnapshotBuffer } from "./snapshot-buffer";

const snapshot = (x: number): BoardSnapshot => ({
  version: 1,
  scene: [
    {
      id: `shape-${x}`,
      type: "rectangle",
      position: { x, y: 20 },
      width: 100,
      height: 60,
      fill: "#0ea5e9",
    },
  ],
});

const write = (roomId: RoomId, value: number) => ({
  roomId,
  snapshot: snapshot(value),
});

describe("snapshot buffer", () => {
  it("coalesces rapid writes for one room after debounce", async () => {
    vi.useFakeTimers();
    try {
      const writes: BoardSnapshot[] = [];
      const buffer = createSnapshotBuffer({
        maxDirtyRooms: 2,
        debounceMs: 50,
        maxAttempts: 2,
        retryDelaysMs: [10],
        persistence: { upsert: async ({ snapshot: value }) => { writes.push(value); } },
      });

      expect(buffer.reserve("room-a")).toBe(true);
      buffer.enqueue(write("room-a", 1));
      buffer.enqueue(write("room-a", 2));

      await vi.advanceTimersByTimeAsync(49);
      expect(writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTicks();

      expect(writes).toEqual([snapshot(2)]);
      expect(buffer.pendingRoomCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a new dirty room at capacity but admits an existing room", () => {
    const buffer = createSnapshotBuffer({
      maxDirtyRooms: 1,
      debounceMs: 100,
      maxAttempts: 1,
      retryDelaysMs: [],
      persistence: { upsert: async () => undefined },
    });

    expect(buffer.reserve("room-a")).toBe(true);
    expect(buffer.reserve("room-b")).toBe(false);
    expect(buffer.reserve("room-a")).toBe(true);
  });

  it("retries a transient failure and retains the latest snapshot until success", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const buffer = createSnapshotBuffer({
        maxDirtyRooms: 1,
        debounceMs: 10,
        maxAttempts: 2,
        retryDelaysMs: [25],
        persistence: {
          upsert: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporarily unavailable");
          },
        },
      });

      buffer.reserve("room-a");
      buffer.enqueue(write("room-a", 3));
      await vi.advanceTimersByTimeAsync(10);
      await vi.runAllTicks();
      expect(buffer.pendingRoomCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(25);
      await vi.runAllTicks();
      expect(attempts).toBe(2);
      expect(buffer.pendingRoomCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a newer snapshot after an older write finishes", async () => {
    let resolveFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const writes: number[] = [];
    const buffer = createSnapshotBuffer({
      maxDirtyRooms: 1,
      debounceMs: 0,
      maxAttempts: 1,
      retryDelaysMs: [],
      persistence: {
        upsert: async ({ snapshot: value }) => {
          const shape = value.scene[0];
          writes.push(shape?.type === "rectangle" ? shape.position.x : -1);
          if (writes.length === 1) await firstWrite;
        },
      },
    });

    buffer.reserve("room-a");
    buffer.enqueue(write("room-a", 4));
    const firstFlush = buffer.flush("room-a");
    buffer.enqueue(write("room-a", 5));
    resolveFirst();
    await firstFlush;
    await buffer.flush("room-a");

    expect(writes).toEqual([4, 5]);
  });

  it("drains pending work before resolving", async () => {
    const writes: number[] = [];
    const buffer = createSnapshotBuffer({
      maxDirtyRooms: 1,
      debounceMs: 10_000,
      maxAttempts: 1,
      retryDelaysMs: [],
      persistence: {
        upsert: async ({ snapshot: value }) => {
          const shape = value.scene[0];
          writes.push(shape?.type === "rectangle" ? shape.position.x : -1);
        },
      },
    });

    buffer.reserve("room-a");
    buffer.enqueue(write("room-a", 6));
    await buffer.drain();

    expect(writes).toEqual([6]);
    expect(buffer.pendingRoomCount()).toBe(0);
  });
});
