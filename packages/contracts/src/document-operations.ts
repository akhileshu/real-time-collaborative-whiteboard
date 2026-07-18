import { z } from "zod";

export const roomIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const clientIdSchema = z.string().min(8).max(128);
export const operationIdSchema = z.string().uuid();

export const scenePointSchema = z
  .object({
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();

export const cursorMessageSchema = z
  .object({
    type: z.literal("cursor"),
    point: scenePointSchema.nullable(),
  })
  .strict();

export const rectangleShapeSchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.literal("rectangle"),
    position: scenePointSchema,
    width: z.number().positive().lte(10_000),
    height: z.number().positive().lte(10_000),
    fill: z.string().min(1).max(32),
  })
  .strict();

export const circleShapeSchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.literal("circle"),
    center: scenePointSchema,
    radius: z.number().positive().lte(10_000),
    fill: z.string().min(1).max(32),
  })
  .strict();

export const wireShapeSchema = z.discriminatedUnion("type", [
  rectangleShapeSchema,
  circleShapeSchema,
]);

export const sceneOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create"),
      operationId: operationIdSchema,
      clientId: clientIdSchema,
      shape: wireShapeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      operationId: operationIdSchema,
      clientId: clientIdSchema,
      shapeId: z.string().min(1).max(256),
      position: scenePointSchema,
    })
    .strict(),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("join"),
      clientId: clientIdSchema,
      initialScene: z.array(wireShapeSchema).max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("operation"),
      operation: sceneOperationSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  cursorMessageSchema,
  z
    .object({
      type: z.literal("document-update"),
      update: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(64_000),
    })
    .strict(),
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("joined"),
      roomId: roomIdSchema,
      clientId: clientIdSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("room-state"),
      scene: z.array(wireShapeSchema),
      revision: z.number().int().nonnegative(),
      memberCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("operation"),
      operation: sceneOperationSchema,
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("document-state"),
      update: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(64_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("document-update"),
      update: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(64_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("room-status"),
      memberCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("presence-state"),
      cursors: z.array(
        z
          .object({
            clientId: clientIdSchema,
            point: scenePointSchema,
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("cursor"),
      clientId: clientIdSchema,
      point: scenePointSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cursor-hidden"),
      clientId: clientIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("protocol-error"),
      code: z.enum([
        "invalid-message",
        "not-joined",
        "invalid-operation",
        "invalid-document",
        "room-unavailable",
      ]),
      message: z.string().max(256),
    })
    .strict(),
]);

export type ScenePoint = z.infer<typeof scenePointSchema>;
export type ClientId = z.infer<typeof clientIdSchema>;
export type CursorMessage = z.infer<typeof cursorMessageSchema>;
export type WireShape = z.infer<typeof wireShapeSchema>;
export type SceneOperation = z.infer<typeof sceneOperationSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
