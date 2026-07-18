import { describe, expect, it } from "vitest";

import { PresenceRegistry } from "./presence-registry";

describe("presence registry", () => {
  it("keeps only the latest cursor for joined members", () => {
    const registry = new PresenceRegistry();
    registry.join("demo", "client-a-123456");

    expect(registry.putCursor("demo", "client-a-123456", { x: 10, y: 20 })).toBe(true);
    expect(registry.putCursor("demo", "client-a-123456", { x: 30, y: 40 })).toBe(true);
    expect(registry.snapshot("demo")).toEqual([
      { clientId: "client-a-123456", point: { x: 30, y: 40 } },
    ]);
  });

  it("does not store cursors for unknown members and removes them idempotently", () => {
    const registry = new PresenceRegistry();

    expect(registry.putCursor("demo", "client-a-123456", { x: 1, y: 2 })).toBe(false);
    registry.join("demo", "client-a-123456");
    registry.putCursor("demo", "client-a-123456", { x: 1, y: 2 });

    expect(registry.removeCursor("demo", "client-a-123456")).toBe(true);
    expect(registry.removeCursor("demo", "client-a-123456")).toBe(false);
    expect(registry.snapshot("demo")).toEqual([]);
  });

  it("isolates rooms and removes presence when the last member leaves", () => {
    const registry = new PresenceRegistry();
    registry.join("one", "client-a-123456");
    registry.join("two", "client-a-123456");
    registry.putCursor("one", "client-a-123456", { x: 1, y: 2 });
    registry.putCursor("two", "client-a-123456", { x: 3, y: 4 });

    expect(registry.snapshot("one")).toEqual([
      { clientId: "client-a-123456", point: { x: 1, y: 2 } },
    ]);
    expect(registry.snapshot("two")).toEqual([
      { clientId: "client-a-123456", point: { x: 3, y: 4 } },
    ]);
    expect(registry.leave("one", "client-a-123456")).toBe(true);
    expect(registry.snapshot("one")).toEqual([]);
  });
});
