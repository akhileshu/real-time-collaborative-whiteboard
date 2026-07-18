"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "@/features/canvas/model";
import { InteractiveCanvas } from "@/features/canvas/interactive-canvas";
import {
  createBoardSnapshot,
  createSharedDocument,
  createSharedDocumentFromState,
  parseBoardSnapshot,
  roomIdSchema,
  type SceneOperation,
  type SharedDocument,
} from "@whiteboard/contracts";
import { api } from "@/utils/api";

import {
  createRoomConnection,
  type RoomConnectionState,
} from "./room-connection";
import type { CursorLayerHandle } from "./cursor-layer";
import { TestCanvasInteractions } from "./test-canvas-interactions";

type CollaborativeWhiteboardProps = {
  roomId: string;
  initialScene: Scene;
};

function connectionStatus(
  state: RoomConnectionState,
  roomId: string,
  memberCount: number,
): string {
  if (state.kind === "connecting") return `Connecting to ${roomId}…`;
  if (state.kind === "connected") return `Connected to ${roomId} · ${memberCount} members`;
  if (state.kind === "closed") return state.reason;
  return "Preparing the room…";
}

export function CollaborativeWhiteboard({
  roomId,
  initialScene,
}: CollaborativeWhiteboardProps) {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [clientId, setClientId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<RoomConnectionState>({
    kind: "idle",
  });
  const [memberCount, setMemberCount] = useState(0);
  const [activity, setActivity] = useState("Waiting for the room connection.");
  const [saveStatus, setSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const connectionRef = useRef<ReturnType<typeof createRoomConnection> | null>(null);
  const documentRef = useRef<SharedDocument | null>(null);
  const [documentReady, setDocumentReady] = useState(false);
  const cursorsRef = useRef(new Map<string, { x: number; y: number }>());
  const cursorLayerRef = useRef<CursorLayerHandle>(null);
  const validRoomId = roomIdSchema.safeParse(roomId).success;
  const boardQuery = api.board.findUnique.useQuery(
    { where: { roomId } },
    { enabled: validRoomId, retry: 1 },
  );
  const utils = api.useContext();
  const saveBoard = api.board.upsert.useMutation({
    onSuccess: async () => {
      setSaveStatus("saved");
      await utils.board.findUnique.invalidate({ where: { roomId } });
    },
    onError: () => setSaveStatus("error"),
  });
  const parsedBoard = useMemo(() => {
    if (!boardQuery.data) return { snapshot: null, error: null };
    try {
      return { snapshot: parseBoardSnapshot(boardQuery.data.snapshot), error: null };
    } catch {
      return { snapshot: null, error: "Saved board could not be loaded." };
    }
  }, [boardQuery.data]);
  const seedScene = (parsedBoard.snapshot?.scene ?? initialScene) as Scene;
  const canJoinRoom = validRoomId && boardQuery.isSuccess && !parsedBoard.error;

  useEffect(() => {
    if (!validRoomId) {
      setConnectionState({ kind: "closed", reason: "Invalid room ID." });
      return;
    }
    if (boardQuery.isLoading) {
      setDocumentReady(false);
      setActivity("Loading the saved board.");
      return;
    }
    if (boardQuery.error || parsedBoard.error) {
      setDocumentReady(false);
      setConnectionState({ kind: "closed", reason: parsedBoard.error ?? "Unable to load the saved board." });
      return;
    }
    if (!canJoinRoom) return;

    const nextClientId = `client-${globalThis.crypto.randomUUID()}`;
    setClientId(nextClientId);
    setScene(seedScene);

    let document = createSharedDocument([], {
      onScene(nextScene) {
        setScene(nextScene as Scene);
      },
      onLocalUpdate(update) {
        setSaveStatus("dirty");
        const sent = connectionRef.current?.sendDocumentUpdate(update) ?? false;
        setActivity(sent ? "Document update sent." : "Unable to send the document update; refresh to rejoin.");
      },
      onApplyError(reason) {
        setActivity(`Document error: ${reason}`);
      },
    });
    documentRef.current = document;
    setDocumentReady(false);

    const connection = createRoomConnection({
      url: process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://127.0.0.1:3001",
      roomId,
      clientId: nextClientId,
      initialScene: seedScene,
      events: {
        onState(nextState) {
          setConnectionState(nextState);
          if (nextState.kind === "connected") {
            setMemberCount(nextState.memberCount);
          }
        },
        onRoomState(message) {
          setMemberCount(message.memberCount);
          setActivity("Room joined; synchronizing the shared document.");
        },
        onOperation(message) {
          setActivity(`Ignoring legacy operation at revision ${message.revision}.`);
        },
        onDocumentState(update) {
          document.destroy();
          document = createSharedDocumentFromState(update, {
            onScene(nextScene) {
              setScene(nextScene as Scene);
            },
            onLocalUpdate(update) {
              setSaveStatus("dirty");
              const sent = connectionRef.current?.sendDocumentUpdate(update) ?? false;
              setActivity(sent ? "Document update sent." : "Unable to send the document update; refresh to rejoin.");
            },
            onApplyError(reason) {
              setActivity(`Document error: ${reason}`);
            },
          });
          documentRef.current = document;
          setScene(document.scene as Scene);
          setDocumentReady(true);
          setSaveStatus("idle");
          setActivity("Shared document synchronized.");
        },
        onDocumentUpdate(update) {
          if (!document.applyUpdate(update)) {
            setConnectionState({ kind: "closed", reason: "Unable to apply the shared document update." });
            return;
          }
          setSaveStatus("dirty");
          setActivity("A collaborator updated the shared document.");
        },
        onRoomStatus(message) {
          setMemberCount(message.memberCount);
        },
        onPresenceState(message) {
          cursorsRef.current = new Map(
            message.cursors.map(({ clientId: remoteClientId, point }) => [remoteClientId, point]),
          );
          cursorLayerRef.current?.setCursors(cursorsRef.current);
        },
        onCursor(message) {
          cursorsRef.current.set(message.clientId, message.point);
          cursorLayerRef.current?.setCursors(cursorsRef.current);
        },
        onCursorHidden(message) {
          cursorsRef.current.delete(message.clientId);
          cursorLayerRef.current?.clearCursor(message.clientId);
        },
        onProtocolError(message) {
          setActivity(message.message);
        },
      },
    });

    connectionRef.current = connection;
    connection.connect();
    const cursorLayer = cursorLayerRef.current;

    return () => {
      connection.close();
      document.destroy();
      documentRef.current = null;
      setDocumentReady(false);
      cursorsRef.current.clear();
      cursorLayer?.setCursors(cursorsRef.current);
      connectionRef.current = null;
    };
  // The query result chooses the seed only before the room starts. Later query
  // invalidation must not replace the active Y.Doc or disconnect collaborators.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canJoinRoom, roomId, validRoomId]);

  const handleLocalOperation = (operation: SceneOperation) => {
    const document = documentRef.current;
    if (!document?.applyOperation(operation)) {
      setActivity("Unable to apply the document operation.");
      return;
    }
    setScene(document.scene as Scene);
  };

  const handleSaveBoard = () => {
    try {
      const snapshot = createBoardSnapshot(scene.map((shape) => ({ ...shape })));
      setSaveStatus("saving");
      saveBoard.mutate({
        where: { roomId },
        create: { roomId, name: "Untitled board", snapshot },
        update: { snapshot },
      });
    } catch {
      setSaveStatus("error");
    }
  };

  const handleClearBoard = () => {
    if (!documentRef.current?.clear()) {
      setActivity("The board is already clear.");
      return;
    }
    setSaveStatus("dirty");
    setActivity("Board cleared. Save to persist this change.");
  };

  const persistenceStatus = boardQuery.isLoading
    ? "Loading saved board…"
    : boardQuery.error || parsedBoard.error
      ? parsedBoard.error ?? "Could not load saved board."
      : saveStatus === "saving"
        ? "Saving board…"
        : saveStatus === "dirty"
          ? "Unsaved changes"
        : saveStatus === "saved"
          ? "Board saved"
          : boardQuery.data
            ? "Saved board loaded"
            : "No saved board yet";

  const isConnected = connectionState.kind === "connected" && documentReady;

  const handleCursorMove = (point: { x: number; y: number }) => {
    connectionRef.current?.sendCursor(point);
  };

  const handleCursorLeave = () => {
    connectionRef.current?.sendCursor(null);
  };

  return (
    <section aria-label="Collaborative whiteboard" className="w-full max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Clear board"
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          disabled={!isConnected || saveStatus === "saving"}
          onClick={handleClearBoard}
        >
          Clear board
        </button>
        <button
          type="button"
          aria-label="Save board"
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          disabled={!isConnected || saveStatus === "saving"}
          onClick={handleSaveBoard}
        >
          {saveStatus === "saving" ? "Saving…" : "Save board"}
        </button>
        {(boardQuery.error || parsedBoard.error) ? (
          <button
            type="button"
            aria-label="Retry saved board"
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
            onClick={() => void boardQuery.refetch()}
          >
            Retry
          </button>
        ) : null}
        <div
          role="status"
          aria-label="Board persistence status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {persistenceStatus}
        </div>
      </div>
      <div
        role="status"
        aria-label="Room connection status"
        aria-live="polite"
        className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"
      >
        {connectionStatus(connectionState, roomId, memberCount)}. {activity}
      </div>
      <TestCanvasInteractions />
      <InteractiveCanvas
        initialScene={scene}
        scene={scene}
        clientId={clientId ?? undefined}
        disabled={!isConnected}
        ariaLabel="Whiteboard canvas with 2 shapes"
        onLocalOperation={handleLocalOperation}
        onCursorMove={handleCursorMove}
        onCursorLeave={handleCursorLeave}
        cursorLayerRef={cursorLayerRef}
      />
    </section>
  );
}
