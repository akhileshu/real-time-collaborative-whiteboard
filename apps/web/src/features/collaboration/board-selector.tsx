"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/utils/api";

type BoardSelectorProps = {
  roomId: string;
};

export function BoardSelector({ roomId }: BoardSelectorProps) {
  const router = useRouter();
  const [newRoomId, setNewRoomId] = useState("");
  const boardsQuery = api.board.findMany.useQuery(
    {
      select: { roomId: true, name: true },
      orderBy: { updatedAt: "desc" },
    },
    { retry: 1 },
  );

  const boards = useMemo(() => {
    const savedBoards = boardsQuery.data ?? [];
    if (savedBoards.some((board) => board.roomId === roomId)) return savedBoards;

    return [{ roomId, name: "Current board" }, ...savedBoards];
  }, [boardsQuery.data, roomId]);

  const handleChange = (nextRoomId: string) => {
    router.push(`/whiteboard?room=${encodeURIComponent(nextRoomId)}`);
  };

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRoomId = newRoomId.trim();
    if (!nextRoomId) return;
    handleChange(nextRoomId);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="board-selector" className="text-sm font-medium">
          Select board
        </label>
        <select
          id="board-selector"
          aria-label="Select board"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={roomId}
          disabled={boardsQuery.isLoading || Boolean(boardsQuery.error)}
          onChange={(event) => handleChange(event.target.value)}
        >
          {boards.map((board) => (
            <option key={board.roomId} value={board.roomId}>
              {board.name} ({board.roomId})
            </option>
          ))}
        </select>
        <span
          aria-label="Available boards count"
          className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
        >
          {boardsQuery.isLoading ? "Loading boards…" : `${boards.length} boards`}
        </span>
        {boardsQuery.error ? (
          <span className="text-sm text-destructive">Unable to load boards.</span>
        ) : null}
      </div>
      <form className="flex items-center gap-2" onSubmit={handleCreate}>
        <label htmlFor="new-board-room" className="sr-only">
          New board room
        </label>
        <input
          id="new-board-room"
          aria-label="New board room"
          className="w-44 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="New board room"
          value={newRoomId}
          onChange={(event) => setNewRoomId(event.target.value)}
        />
        <button
          type="submit"
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          disabled={!newRoomId.trim()}
        >
          Create board
        </button>
      </form>
    </div>
  );
}
