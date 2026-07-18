import { z } from "zod";

export const roomIdSchema = z.string().min(1).max(128);

export type RoomId = z.infer<typeof roomIdSchema>;
