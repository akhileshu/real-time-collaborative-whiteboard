export function createRenderScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (id: number) => void,
  render: () => void,
) {
  let pendingFrame: number | null = null;

  return {
    request() {
      if (pendingFrame !== null) return;

      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        render();
      });
    },
    cancel() {
      if (pendingFrame === null) return;

      cancelFrame(pendingFrame);
      pendingFrame = null;
    },
    hasPendingFrame() {
      return pendingFrame !== null;
    },
  };
}
