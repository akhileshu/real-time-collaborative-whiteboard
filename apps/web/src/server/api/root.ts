import { createRouter } from "@/server/api/routers/generated/routers";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const appRouter = createRouter(createTRPCRouter, publicProcedure);

export type AppRouter = typeof appRouter;
