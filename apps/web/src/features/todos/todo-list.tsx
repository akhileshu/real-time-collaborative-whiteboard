"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createTodoSchema } from "@/features/todos/todo-schema";
import type { CreateTodoInput } from "@/features/todos/todo-schema";
import { useTodoUiStore, type TodoFilter } from "@/features/todos/todo-ui-store";
import { api } from "@/utils/api";

const filters: Array<{ value: TodoFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

export function TodoList() {
  const filter = useTodoUiStore((state) => state.filter);
  const setFilter = useTodoUiStore((state) => state.setFilter);
  const utils = api.useContext();
  const form = useForm<CreateTodoInput>({
    defaultValues: { title: "" },
    resolver: zodResolver(createTodoSchema),
  });
  const todosQuery = api.todo.findMany.useQuery({ orderBy: { createdAt: "desc" } });
  const createTodo = api.todo.create.useMutation({
    onSuccess: async () => {
      form.reset();
      await utils.todo.findMany.invalidate();
    },
  });

  const todos = useMemo(() => {
    const data = todosQuery.data ?? [];
    if (filter === "active") return data.filter((todo) => !todo.completed);
    if (filter === "completed") return data.filter((todo) => todo.completed);
    return data;
  }, [filter, todosQuery.data]);

  const submit = form.handleSubmit((values) => {
    createTodo.mutate({ data: values });
  });

  return (
    <section aria-labelledby="todos-heading" className="w-full max-w-2xl rounded-lg border bg-card p-8 shadow-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">T3 + ZenStack tracer</p>
          <h1 id="todos-heading" className="mt-2 text-3xl font-bold tracking-tight">Todos</h1>
        </div>
        <div aria-label="Todo filter" className="flex gap-1" role="group">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              className="rounded border px-3 py-1 text-sm"
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <form className="mt-6 flex gap-3" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor="todo-title">Todo title</label>
        <input
          id="todo-title"
          aria-describedby={form.formState.errors.title ? "todo-title-error" : undefined}
          aria-invalid={form.formState.errors.title ? "true" : "false"}
          {...form.register("title")}
          className="min-w-0 flex-1 rounded border px-3 py-2"
          placeholder="What needs doing?"
        />
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={createTodo.isLoading} type="submit">
          {createTodo.isLoading ? "Adding…" : "Add todo"}
        </button>
      </form>
      {form.formState.errors.title ? <p id="todo-title-error" className="mt-2 text-sm text-destructive">{form.formState.errors.title.message}</p> : null}
      {createTodo.error ? <p className="mt-2 text-sm text-destructive">Could not create todo.</p> : null}

      <div className="mt-6" aria-live="polite">
        {todosQuery.isLoading ? <p>Loading todos…</p> : null}
        {todosQuery.error ? <p className="text-destructive">Could not load todos.</p> : null}
        {!todosQuery.isLoading && !todosQuery.error && todos.length === 0 ? <p className="text-muted-foreground">No todos yet.</p> : null}
        <ul className="space-y-2">
          {todos.map((todo) => <li key={todo.id} className="rounded border px-3 py-2">{todo.title}</li>)}
        </ul>
      </div>
    </section>
  );
}
