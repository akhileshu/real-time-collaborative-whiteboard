import { describe, expect, it, vi } from "vitest";

import { createShutdown } from "./shutdown";

describe("realtime shutdown", () => {
  it("drains snapshots before stopping the server and is idempotent", async () => {
    const events: string[] = [];
    const drain = vi.fn(async () => { events.push("drain"); });
    const stop = vi.fn(async () => { events.push("stop"); });
    const shutdown = createShutdown({ drain, stop });

    await Promise.all([shutdown(), shutdown()]);

    expect(events).toEqual(["drain", "stop"]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops the server and preserves a drain failure", async () => {
    const stop = vi.fn(async () => undefined);
    const shutdown = createShutdown({
      drain: async () => { throw new Error("flush failed"); },
      stop,
    });

    await expect(shutdown()).rejects.toThrow("flush failed");
    expect(stop).toHaveBeenCalledOnce();
  });
});
