import { beforeEach, describe, expect, it } from "vitest";

import { useTodoUiStore } from "./todo-ui-store";

describe("todo UI store", () => {
  beforeEach(() => {
    useTodoUiStore.getState().reset();
  });

  it("starts with all todos visible", () => {
    expect(useTodoUiStore.getState().filter).toBe("all");
  });

  it("updates and resets the todo filter", () => {
    useTodoUiStore.getState().setFilter("active");
    expect(useTodoUiStore.getState().filter).toBe("active");

    useTodoUiStore.getState().reset();
    expect(useTodoUiStore.getState().filter).toBe("all");
  });
});
