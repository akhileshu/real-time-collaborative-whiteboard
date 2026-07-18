import { z } from "zod";

import { wireShapeSchema } from "./document-operations";

export const BOARD_SNAPSHOT_VERSION = 1 as const;
export const MAX_BOARD_SNAPSHOT_BYTES = 1_048_576;

export const boardSnapshotSchema = z
  .object({
    version: z.literal(BOARD_SNAPSHOT_VERSION),
    scene: z.array(wireShapeSchema).max(10_000),
  })
  .strict();

export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

export function parseBoardSnapshot(value: unknown): BoardSnapshot {
  const parsed = boardSnapshotSchema.parse(value);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (bytes > MAX_BOARD_SNAPSHOT_BYTES) {
    throw new Error("Board snapshot is too large.");
  }
  return parsed;
}

export function createBoardSnapshot(
  scene: BoardSnapshot["scene"],
): BoardSnapshot {
  return parseBoardSnapshot({
    version: BOARD_SNAPSHOT_VERSION,
    scene,
  });
}
