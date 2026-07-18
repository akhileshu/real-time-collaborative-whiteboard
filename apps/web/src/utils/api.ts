import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

import type { AppRouter } from "@/server/api/root";

export const api = createTRPCReact<AppRouter>();

const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin;
  return `http://localhost:${process.env.PORT ?? 3000}`;
};

export const createTRPCClient = () =>
  api.createClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
      }),
    ],
  });
