import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { enhance } from "@zenstackhq/runtime";

import { prisma } from "@/server/db";

export const createTRPCContext = () => ({
  prisma: enhance(prisma, { user: undefined }),
});

const t = initTRPC.context<ReturnType<typeof createTRPCContext>>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
