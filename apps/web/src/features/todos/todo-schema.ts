import { z } from "zod";

export const createTodoSchema = z.object({
  title: z.string().trim().min(1, "Enter a todo title").max(200),
});

export type CreateTodoInput = z.infer<typeof createTodoSchema>;
