import { describe, expect, it } from "vitest";

import { formatTestTimer, randomDelay } from "./test-canvas-interactions";

describe("test canvas interaction helpers", () => {
  it("formats the remaining demo time as a countdown", () => {
    expect(formatTestTimer(60_000)).toBe("01:00");
    expect(formatTestTimer(1_000)).toBe("00:01");
    expect(formatTestTimer(-1)).toBe("00:00");
  });

  it("keeps interaction delays inside the jitter window", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(randomDelay(700, 1_300)).toBeGreaterThanOrEqual(700);
      expect(randomDelay(700, 1_300)).toBeLessThanOrEqual(1_300);
    }
  });
});
