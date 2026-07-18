export type ShutdownHooks = {
  drain: () => Promise<void>;
  stop: () => Promise<unknown> | unknown;
};

export function createShutdown(hooks: ShutdownHooks): () => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return () => {
    shutdownPromise ??= (async () => {
      try {
        await hooks.drain();
      } finally {
        await hooks.stop();
      }
    })();
    return shutdownPromise;
  };
}
