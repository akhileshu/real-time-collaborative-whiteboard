import { describe, expect, it } from "vitest";

import { parseBoardSnapshot } from "./board-snapshot";

const rectangle = {
  id: "rectangle-1",
  type: "rectangle" as const,
  position: { x: 10, y: 20 },
  width: 100,
  height: 60,
  fill: "#0ea5e9",
};

describe("board snapshot contract", () => {
  it("accepts the supported version and preserves the scene", () => {
    expect(parseBoardSnapshot({ version: 1, scene: [rectangle] })).toEqual({
      version: 1,
      scene: [rectangle],
    });
  });

  it("rejects unsupported versions and invalid shapes", () => {
    expect(() => parseBoardSnapshot({ version: 2, scene: [] })).toThrow();
    expect(() => parseBoardSnapshot({
      version: 1,
      scene: [{ ...rectangle, width: 0 }],
    })).toThrow();
  });
});
