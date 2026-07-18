import {
  parseBoardSnapshot,
  type BoardSnapshot,
  type RoomId,
} from "@whiteboard/contracts";

export type SnapshotWrite = {
  roomId: RoomId;
  snapshot: BoardSnapshot;
};

export type BoardSnapshotPersistence = {
  upsert: (write: SnapshotWrite) => Promise<void>;
};

export type SnapshotBufferOptions = {
  maxDirtyRooms: number;
  debounceMs: number;
  maxAttempts: number;
  retryDelaysMs: readonly number[];
  persistence: BoardSnapshotPersistence;
  isRetryable?: (error: unknown) => boolean;
  onMetrics?: (metrics: SnapshotBufferMetrics) => void;
};

export type SnapshotBufferMetrics = {
  pendingRoomCount: number;
  successfulFlushes: number;
  retryAttempts: number;
  terminalFailures: number;
  flushDurationMs: number;
};

export type SnapshotBuffer = {
  reserve: (roomId: RoomId) => boolean;
  enqueue: (write: SnapshotWrite) => void;
  flush: (roomId?: RoomId) => Promise<void>;
  drain: () => Promise<void>;
  pendingRoomCount: () => number;
  metrics: () => SnapshotBufferMetrics;
};

type Timer = ReturnType<typeof setTimeout>;

type Entry = {
  write: SnapshotWrite | null;
  version: number;
  attempts: number;
  timer: Timer | null;
  inFlight: Promise<void> | null;
  terminalError: unknown | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Snapshot persistence failed.";
}

export function createSnapshotBuffer(options: SnapshotBufferOptions): SnapshotBuffer {
  const entries = new Map<RoomId, Entry>();
  const counters = {
    successfulFlushes: 0,
    retryAttempts: 0,
    terminalFailures: 0,
    flushDurationMs: 0,
  };

  const emitMetrics = () => {
    options.onMetrics?.({
      pendingRoomCount: entries.size,
      ...counters,
    });
  };

  const clearTimer = (entry: Entry) => {
    if (entry.timer === null) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  };

  const schedule = (roomId: RoomId, delayMs: number) => {
    const entry = entries.get(roomId);
    if (!entry || entry.terminalError !== null) return;
    clearTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void flush(roomId);
    }, Math.max(0, delayMs));
  };

  const flush = async (roomId?: RoomId): Promise<void> => {
    const roomIds = roomId ? [roomId] : Array.from(entries.keys());
    for (const currentRoomId of roomIds) {
      const entry = entries.get(currentRoomId);
      if (!entry) continue;
      if (entry.inFlight) {
        await entry.inFlight;
        continue;
      }
      if (!entry.write || entry.terminalError !== null) continue;

      clearTimer(entry);
      const capturedWrite = entry.write;
      const capturedVersion = entry.version;
      const startedAt = Date.now();
      const inFlight = (async () => {
        try {
          await options.persistence.upsert(capturedWrite);
          counters.successfulFlushes += 1;

          const current = entries.get(currentRoomId);
          if (!current || current.version === capturedVersion) {
            entries.delete(currentRoomId);
          } else {
            current.attempts = 0;
            schedule(currentRoomId, options.debounceMs);
          }
        } catch (error) {
          const current = entries.get(currentRoomId);
          if (!current) return;

          if (current.version !== capturedVersion) {
            current.attempts = 0;
            schedule(currentRoomId, options.debounceMs);
            return;
          }

          current.attempts += 1;
          const retryable = options.isRetryable?.(error) ?? true;
          if (!retryable || current.attempts >= Math.max(1, options.maxAttempts)) {
            current.terminalError = error;
            counters.terminalFailures += 1;
          } else {
            counters.retryAttempts += 1;
            const delayIndex = Math.min(
              current.attempts - 1,
              Math.max(0, options.retryDelaysMs.length - 1),
            );
            schedule(currentRoomId, options.retryDelaysMs[delayIndex] ?? 0);
          }
        } finally {
          counters.flushDurationMs += Math.max(0, Date.now() - startedAt);
          emitMetrics();
        }
      })();
      entry.inFlight = inFlight;
      try {
        await inFlight;
      } finally {
        entry.inFlight = null;
        emitMetrics();
      }
    }
  };

  const drain = async () => {
    for (;;) {
      const pendingEntries = Array.from(entries.entries());
      if (pendingEntries.length === 0) return;

      for (const [roomId, entry] of pendingEntries) {
        clearTimer(entry);
        if (entry.inFlight) {
          await entry.inFlight;
        } else if (entry.terminalError === null) {
          await flush(roomId);
        }
      }

      const terminal = Array.from(entries.values()).find((entry) => entry.terminalError !== null);
      if (terminal) throw new Error(errorMessage(terminal.terminalError));
    }
  };

  return {
    reserve(roomId) {
      if (entries.has(roomId)) return true;
      if (entries.size >= Math.max(0, options.maxDirtyRooms)) return false;
      entries.set(roomId, {
        write: null,
        version: 0,
        attempts: 0,
        timer: null,
        inFlight: null,
        terminalError: null,
      });
      emitMetrics();
      return true;
    },
    enqueue(write) {
      const entry = entries.get(write.roomId);
      if (!entry) throw new Error(`Room ${write.roomId} must reserve buffer capacity first.`);
      entry.write = { roomId: write.roomId, snapshot: parseBoardSnapshot(write.snapshot) };
      entry.version += 1;
      entry.attempts = 0;
      entry.terminalError = null;
      if (!entry.inFlight) schedule(write.roomId, options.debounceMs);
      emitMetrics();
    },
    flush,
    drain,
    pendingRoomCount: () => entries.size,
    metrics: () => ({ pendingRoomCount: entries.size, ...counters }),
  };
}
