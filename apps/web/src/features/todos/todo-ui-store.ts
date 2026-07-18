import { create } from "zustand";

export type TodoFilter = "all" | "active" | "completed";

type TodoUiState = {
  filter: TodoFilter;
  setFilter: (filter: TodoFilter) => void;
  reset: () => void;
};

export const useTodoUiStore = create<TodoUiState>((set) => ({
  filter: "all",
  setFilter: (filter) => set({ filter }),
  reset: () => set({ filter: "all" }),
}));
