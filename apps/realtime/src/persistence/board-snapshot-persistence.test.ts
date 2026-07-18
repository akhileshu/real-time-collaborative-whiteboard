import { describe, expect, it, vi } from "vitest";

import { createTRPCBoardSnapshotPersistence } from "./board-snapshot-persistence";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const write = {
  roomId: "room-a" as const,
  snapshot: {
    version: 1 as const,
    scene: [],
  },
};

describe("tRPC board snapshot persistence", () => {
  it("upserts through the existing web tRPC boundary", async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(
      JSON.stringify([{ result: { data: { json: { id: "board-1" } } } }]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const persistence = createTRPCBoardSnapshotPersistence({
      endpoint: "http://web.test/api/trpc/board.upsert",
      fetcher,
    });

    await persistence.upsert(write);

    expect(fetcher).toHaveBeenCalledWith(
      "http://web.test/api/trpc/board.upsert?batch=1",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      0: {
        json: {
          where: { roomId: "room-a" },
          create: { roomId: "room-a", name: "Untitled board", snapshot: write.snapshot },
          update: { snapshot: write.snapshot },
        },
      },
    });
  });

  it("classifies unavailable web responses as retryable", async () => {
    const persistence = createTRPCBoardSnapshotPersistence({
      endpoint: "http://web.test/api/trpc/board.upsert",
      fetcher: vi.fn<Fetcher>(async () => new Response("down", { status: 503 })),
    });

    await expect(persistence.upsert(write)).rejects.toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
  });

  it("classifies validation failures as terminal", async () => {
    const persistence = createTRPCBoardSnapshotPersistence({
      endpoint: "http://web.test/api/trpc/board.upsert",
      fetcher: vi.fn<Fetcher>(async () => new Response("bad request", { status: 400 })),
    });

    await expect(persistence.upsert(write)).rejects.toMatchObject({
      kind: "validation",
      retryable: false,
    });
  });
});
