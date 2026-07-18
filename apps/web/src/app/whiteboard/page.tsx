import { CollaborativeWhiteboard } from "@/features/collaboration/collaborative-whiteboard";
import { BoardSelector } from "@/features/collaboration/board-selector";
import type { Scene } from "@/features/canvas/model";

const scene: Scene = [
  {
    id: "rectangle-1",
    type: "rectangle",
    position: { x: 80, y: 70 },
    width: 220,
    height: 140,
    fill: "#0ea5e9",
  },
  {
    id: "circle-1",
    type: "circle",
    center: { x: 460, y: 190 },
    radius: 80,
    fill: "#f97316",
  },
];

export default function WhiteboardPage({
  searchParams,
}: {
  searchParams?: { room?: string };
}) {
  const roomId = searchParams?.room ?? "demo";

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Realtime room</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Whiteboard</h1>
        </div>
        <BoardSelector roomId={roomId} />
      </div>
      <CollaborativeWhiteboard
        roomId={roomId}
        initialScene={scene}
      />
    </main>
  );
}
