import { describe, expect, it } from "vitest";

import { applyRemoteOperation } from "./operations";
import type { Scene } from "./model";

const scene: Scene = [
  {
    id: "rectangle-1",
    type: "rectangle",
    position: { x: 20, y: 30 },
    width: 120,
    height: 80,
    fill: "#0ea5e9",
  },
];

describe("remote canvas operations", () => {
  it("applies remote create and move operations", () => {
    const created = applyRemoteOperation(scene, {
      kind: "create",
      operationId: "00000000-0000-4000-8000-000000000001",
      clientId: "client-a-123456",
      shape: {
        id: "client-a-123456:rectangle:1",
        type: "rectangle",
        position: { x: 200, y: 100 },
        width: 120,
        height: 80,
        fill: "#22c55e",
      },
    });
    expect(created).toHaveLength(2);

    const moved = applyRemoteOperation(created, {
      kind: "move",
      operationId: "00000000-0000-4000-8000-000000000002",
      clientId: "client-a-123456",
      shapeId: "rectangle-1",
      position: { x: 90, y: 100 },
    });
    expect(moved[0]).toMatchObject({ position: { x: 90, y: 100 } });
  });

  it("ignores invalid or duplicate shape operations", () => {
    const operation = {
      kind: "create" as const,
      operationId: "00000000-0000-4000-8000-000000000001",
      clientId: "client-a-123456",
      shape: scene[0]!,
    };
    expect(applyRemoteOperation(scene, operation)).toBe(scene);
    expect(
      applyRemoteOperation(scene, {
        kind: "move",
        operationId: "00000000-0000-4000-8000-000000000002",
        clientId: "client-a-123456",
        shapeId: "missing",
        position: { x: 1, y: 1 },
      }),
    ).toBe(scene);
  });
});
