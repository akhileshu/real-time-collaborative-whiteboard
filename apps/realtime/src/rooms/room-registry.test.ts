import { describe, expect, it, vi } from "vitest";

import type { SceneOperation, WireShape } from "@whiteboard/contracts";
import { createSharedDocumentFromState } from "@whiteboard/contracts";

import { RoomRegistry } from "./room-registry";

const rectangle: WireShape = {
  id: "seed:rectangle:1",
  type: "rectangle",
  position: { x: 20, y: 30 },
  width: 120,
  height: 80,
  fill: "#0ea5e9",
};

const createOperation: SceneOperation = {
  kind: "create",
  operationId: "00000000-0000-4000-8000-000000000001",
  clientId: "client-a-123456",
  shape: { ...rectangle, id: "client-a-123456:rectangle:1" },
};

describe("room registry", () => {
  it("joins members and keeps the first scene authoritative", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    const second = { clientId: "client-b-123456", send: vi.fn() };

    expect(registry.join("demo", first, [rectangle])).toMatchObject({
      ok: true,
      snapshot: { revision: 0, memberCount: 1, scene: [rectangle] },
    });
    expect(registry.join("demo", second, [])).toMatchObject({
      ok: true,
      snapshot: { revision: 0, memberCount: 2, scene: [rectangle] },
    });
  });

  it("applies an operation once and exposes other members for broadcast", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    const second = { clientId: "client-b-123456", send: vi.fn() };
    registry.join("demo", first, [rectangle]);
    registry.join("demo", second, []);

    expect(registry.apply("demo", first.clientId, createOperation)).toMatchObject({
      ok: true,
      revision: 1,
      scene: [rectangle, createOperation.shape],
    });
    expect(registry.members("demo", first.clientId)).toEqual([second]);
    expect(registry.apply("demo", first.clientId, createOperation)).toMatchObject({
      ok: false,
      code: "duplicate-operation",
    });
  });

  it("does not mutate on unknown members or invalid targets", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    registry.join("demo", first, [rectangle]);

    expect(registry.apply("demo", "unknown-client", createOperation)).toMatchObject({
      ok: false,
      code: "not-member",
    });

    const invalidMove: SceneOperation = {
      kind: "move",
      operationId: "00000000-0000-4000-8000-000000000002",
      clientId: first.clientId,
      shapeId: "missing",
      position: { x: 10, y: 10 },
    };
    expect(registry.apply("demo", first.clientId, invalidMove)).toMatchObject({
      ok: false,
      code: "invalid-operation",
    });
    expect(registry.snapshot("demo")).toMatchObject({ revision: 0, scene: [rectangle] });
  });

  it("removes empty rooms after the last member leaves", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    registry.join("demo", first, []);

    registry.leave("demo", first.clientId);

    expect(registry.snapshot("demo")).toBeNull();
  });

  it("applies a client document update and exposes the converged scene", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    const second = { clientId: "client-b-123456", send: vi.fn() };
    const joined = registry.join("demo", first, [rectangle]);
    registry.join("demo", second, []);
    if (!joined.ok) throw new Error("Expected the first member to join.");
    const document = createSharedDocumentFromState(joined.snapshot.documentState);
    document.applyOperation({
      kind: "create",
      operationId: "00000000-0000-4000-8000-000000000005",
      clientId: first.clientId,
      shape: { ...rectangle, id: "client-a-123456:new" },
    });

    expect(registry.applyUpdate("demo", first.clientId, document.encodeState())).toMatchObject({
      ok: true,
      scene: [rectangle, { ...rectangle, id: "client-a-123456:new" }],
    });
  });

  it("rejects a valid document update before mutation when admission is full", () => {
    const registry = new RoomRegistry();
    const first = { clientId: "client-a-123456", send: vi.fn() };
    registry.join("demo", first, [rectangle]);
    const document = createSharedDocumentFromState(registry.snapshot("demo")!.documentState);
    document.applyOperation({
      kind: "create",
      operationId: "00000000-0000-4000-8000-000000000006",
      clientId: first.clientId,
      shape: { ...rectangle, id: "client-a-123456:capacity" },
    });

    expect(registry.applyUpdate("demo", first.clientId, document.encodeState(), () => false)).toMatchObject({
      ok: false,
      code: "persistence-capacity",
    });
    expect(registry.snapshot("demo")).toMatchObject({ revision: 0, scene: [rectangle] });
  });
});
