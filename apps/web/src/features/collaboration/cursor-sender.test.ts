import { describe, expect, it, vi } from "vitest";

import { createCursorSender } from "./cursor-sender";

describe("cursor sender", () => {
  it("coalesces rapid points and sends no more than one point per interval", () => {
    vi.useFakeTimers();
    const sent: Array<{ x: number; y: number } | null> = [];
    const sender = createCursorSender(
      (point) => {
        sent.push(point);
        return true;
      },
      () => Date.now(),
      50,
    );

    sender.send({ x: 1, y: 1 });
    sender.send({ x: 2, y: 2 });
    sender.send({ x: 3, y: 3 });
    expect(sent).toEqual([{ x: 1, y: 1 }]);
    expect(sender.stats.throttled).toBe(2);

    vi.advanceTimersByTime(49);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
    vi.useRealTimers();
  });

  it("sends hide immediately and does not send after close", () => {
    const send = vi.fn(() => true);
    const sender = createCursorSender(send, () => 100);

    sender.send({ x: 1, y: 1 });
    sender.send({ x: 2, y: 2 });
    sender.send(null);
    sender.close();
    expect(send.mock.calls).toEqual([[{ x: 1, y: 1 }], [null]]);
    expect(sender.send({ x: 3, y: 3 })).toBe(false);
  });
});
