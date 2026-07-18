import type { RoomId } from "@whiteboard/contracts";

import type {
  BoardSnapshotPersistence,
  SnapshotWrite,
} from "./snapshot-buffer";

export type BoardPersistenceErrorKind =
  | "validation"
  | "forbidden"
  | "conflict"
  | "unavailable";

export class BoardSnapshotPersistenceError extends Error {
  readonly kind: BoardPersistenceErrorKind;
  readonly retryable: boolean;

  constructor(kind: BoardPersistenceErrorKind, retryable: boolean, message: string) {
    super(message);
    this.name = "BoardSnapshotPersistenceError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export type TRPCBoardSnapshotPersistenceOptions = {
  endpoint: string;
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

type TRPCErrorEnvelope = {
  error?: {
    data?: { code?: string };
  };
};

function classifyStatus(status: number): BoardSnapshotPersistenceError {
  if (status === 401 || status === 403) {
    return new BoardSnapshotPersistenceError(
      "forbidden",
      false,
      "Board snapshot persistence is not permitted.",
    );
  }
  if (status === 409) {
    return new BoardSnapshotPersistenceError(
      "conflict",
      false,
      "Board snapshot persistence encountered a conflict.",
    );
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new BoardSnapshotPersistenceError(
      "unavailable",
      true,
      "Board persistence is temporarily unavailable.",
    );
  }
  return new BoardSnapshotPersistenceError(
    "validation",
    false,
    "Board snapshot was rejected by the persistence boundary.",
  );
}

function classifyTRPCError(code: string | undefined): BoardSnapshotPersistenceError {
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return classifyStatus(code === "FORBIDDEN" ? 403 : 401);
  }
  if (code === "CONFLICT") return classifyStatus(409);
  if (code === "INTERNAL_SERVER_ERROR" || code === "TIMEOUT") return classifyStatus(503);
  return classifyStatus(400);
}

export function isRetryablePersistenceError(error: unknown): boolean {
  return error instanceof BoardSnapshotPersistenceError ? error.retryable : true;
}

export function createTRPCBoardSnapshotPersistence(
  options: TRPCBoardSnapshotPersistenceOptions,
): BoardSnapshotPersistence {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = options.endpoint.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async upsert(write: SnapshotWrite): Promise<void> {
      const input = {
        where: { roomId: write.roomId as RoomId },
        create: {
          roomId: write.roomId,
          name: "Untitled board",
          snapshot: write.snapshot,
        },
        update: { snapshot: write.snapshot },
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetcher(`${endpoint}?batch=1`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ 0: { json: input } }),
          signal: controller.signal,
        });
      } catch {
        throw new BoardSnapshotPersistenceError(
          "unavailable",
          true,
          "Board persistence is temporarily unavailable.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) throw classifyStatus(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new BoardSnapshotPersistenceError(
          "unavailable",
          true,
          "Board persistence returned an invalid response.",
        );
      }

      const envelope = Array.isArray(payload) ? payload[0] as TRPCErrorEnvelope | undefined : undefined;
      const code = envelope?.error?.data?.code;
      if (code) throw classifyTRPCError(code);
    },
  };
}
