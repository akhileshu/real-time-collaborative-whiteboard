import { TodoList } from "@/features/todos/todo-list";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <TodoList />
    </main>
  );
}
