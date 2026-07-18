import type { ScenePoint } from "@whiteboard/contracts";

export type CursorSenderStats = {
  throttled: number;
  sent: number;
  failed: number;
};

type Timer = ReturnType<typeof setTimeout>;

export function createCursorSender(
  send: (point: ScenePoint | null) => boolean,
  now: () => number = () => Date.now(),
  intervalMs = 50,
) {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: ScenePoint | null = null;
  let timer: Timer | null = null;
  let closed = false;
  const stats: CursorSenderStats = { throttled: 0, sent: 0, failed: 0 };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (point: ScenePoint | null): boolean => {
    lastSentAt = now();
    const sent = send(point);
    if (sent) stats.sent += 1;
    else stats.failed += 1;
    return sent;
  };

  const flush = () => {
    timer = null;
    if (closed || pending === null) return;
    const wait = intervalMs - (now() - lastSentAt);
    if (wait > 0) {
      timer = setTimeout(flush, wait);
      return;
    }
    const next = pending;
    pending = null;
    emit(next);
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, Math.max(0, intervalMs - (now() - lastSentAt)));
  };

  return {
    send(point: ScenePoint | null): boolean {
      if (closed) return false;
      if (point === null) {
        pending = null;
        clearTimer();
        return emit(null);
      }

      if (now() - lastSentAt >= intervalMs) {
        return emit(point);
      }

      pending = point;
      stats.throttled += 1;
      schedule();
      return true;
    },
    close() {
      closed = true;
      pending = null;
      clearTimer();
    },
    stats,
  };
}
