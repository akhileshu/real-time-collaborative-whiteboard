import { describe, expect, it } from "vitest";

import { parseServerMessage, readRealtimeUrl } from "./room-connection";

describe("room connection boundary", () => {
  it("parses valid server messages and rejects malformed payloads", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "room-status", memberCount: 2 })),
    ).toEqual({ type: "room-status", memberCount: 2 });
    expect(parseServerMessage("{invalid")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  it("validates the browser WebSocket endpoint", () => {
    expect(readRealtimeUrl("ws://localhost:3001")).toBe("ws://localhost:3001");
    expect(() => readRealtimeUrl("http://localhost:3001")).toThrow();
  });
});
