import { describe, expect, it } from "vitest";

import {
  clientMessageSchema,
  serverMessageSchema,
} from "./document-operations";

const shape = {
  id: "client-a:rectangle:1",
  type: "rectangle" as const,
  position: { x: 20, y: 30 },
  width: 120,
  height: 80,
  fill: "#22c55e",
};

describe("document operation contracts", () => {
  it("accepts valid join and operation envelopes", () => {
    expect(
      clientMessageSchema.parse({
        type: "join",
        clientId: "client-a-123456",
        initialScene: [shape],
      }),
    ).toMatchObject({ type: "join" });

    expect(
      clientMessageSchema.parse({
        type: "operation",
        revision: 0,
        operation: {
          kind: "create",
          operationId: "00000000-0000-4000-8000-000000000001",
          clientId: "client-a-123456",
          shape,
        },
      }),
    ).toMatchObject({ type: "operation" });

    expect(
      clientMessageSchema.parse({
        type: "cursor",
        point: { x: 40, y: 50 },
      }),
    ).toEqual({ type: "cursor", point: { x: 40, y: 50 } });
    expect(
      serverMessageSchema.parse({
        type: "presence-state",
        cursors: [{ clientId: "client-a-123456", point: { x: 40, y: 50 } }],
      }),
    ).toMatchObject({ type: "presence-state" });
  });

  it("rejects unbounded or non-finite geometry", () => {
    expect(() =>
      clientMessageSchema.parse({
        type: "join",
        clientId: "client-a-123456",
        initialScene: [{ ...shape, position: { x: Infinity, y: 0 } }],
      }),
    ).toThrow();

    expect(() =>
      serverMessageSchema.parse({
        type: "operation",
        revision: 1,
        operation: {
          kind: "move",
          operationId: "not-a-uuid",
          clientId: "client-a-123456",
          shapeId: shape.id,
          position: { x: 20, y: 30 },
        },
      }),
    ).toThrow();
  });
});
