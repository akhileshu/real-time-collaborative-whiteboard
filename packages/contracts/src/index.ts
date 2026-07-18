import { z } from "zod";

export * from "./document-operations";
export * from "./board-snapshot";
export * from "./shared-document";
import { roomIdSchema } from "./document-operations";

export type RoomId = z.infer<typeof roomIdSchema>;
