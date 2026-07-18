import { describe, expect, it } from "vitest";

import {
  createSharedDocument,
  createSharedDocumentFromState,
  type SharedDocument,
} from "./shared-document";

const rectangle = {
  id: "rectangle-1",
  type: "rectangle" as const,
  position: { x: 10, y: 20 },
  width: 100,
  height: 60,
  fill: "#ff0000",
};

const createOperation = (clientId: string, id: string, x: number) => ({
  kind: "create" as const,
  operationId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
  clientId,
  shape: {
    ...rectangle,
    id: `${clientId}-shape`,
    position: { x, y: 20 },
  },
});

function exchange(left: SharedDocument, right: SharedDocument): void {
  const leftUpdate = left.encodeState();
  const rightUpdate = right.encodeState();
  left.applyUpdate(rightUpdate);
  right.applyUpdate(leftUpdate);
}

describe("shared document", () => {
  it("converges concurrent creates regardless of update order", () => {
    const first = createSharedDocument([]);
    const second = createSharedDocument([]);

    first.applyOperation(createOperation("client-a", "1", 10));
    second.applyOperation(createOperation("client-b", "2", 200));
    exchange(first, second);

    expect(first.scene).toEqual(second.scene);
    expect(first.scene).toHaveLength(2);
  });

  it("converges concurrent moves of the same shape", () => {
    const first = createSharedDocument([rectangle]);
    const second = createSharedDocumentFromState(first.encodeState());

    first.applyOperation({
      kind: "move",
      operationId: "00000000-0000-4000-8000-000000000003",
      clientId: "client-a",
      shapeId: rectangle.id,
      position: { x: 40, y: 50 },
    });
    second.applyOperation({
      kind: "move",
      operationId: "00000000-0000-4000-8000-000000000004",
      clientId: "client-b",
      shapeId: rectangle.id,
      position: { x: 80, y: 90 },
    });
    exchange(first, second);

    expect(first.scene).toEqual(second.scene);
  });

  it("does not emit another local update when applying a remote update", () => {
    const updates: Uint8Array[] = [];
    const first = createSharedDocument([], {
      onLocalUpdate: (update) => updates.push(update),
    });
    const second = createSharedDocument([]);

    second.applyOperation(createOperation("client-b", "5", 200));
    first.applyUpdate(second.encodeState());

    expect(updates).toHaveLength(0);
    expect(first.scene).toHaveLength(1);
  });

  it("clears all shapes and synchronizes the empty scene", () => {
    const updates: Uint8Array[] = [];
    const first = createSharedDocument([rectangle], {
      onLocalUpdate: (update) => updates.push(update),
    });
    const second = createSharedDocumentFromState(first.encodeState());

    expect(first.clear()).toBe(true);
    expect(first.scene).toEqual([]);
    expect(updates).toHaveLength(1);

    second.applyUpdate(updates[0]!);
    expect(second.scene).toEqual([]);
  });

  it("accepts circle creation operations", () => {
    const document = createSharedDocument([]);

    expect(document.applyOperation({
      kind: "create",
      operationId: "00000000-0000-4000-8000-000000000006",
      clientId: "client-circle",
      shape: {
        id: "client-circle:circle-2",
        type: "circle",
        center: { x: 200, y: 150 },
        radius: 40,
        fill: "#a855f7",
      },
    })).toBe(true);
    expect(document.scene).toHaveLength(1);
  });
});
