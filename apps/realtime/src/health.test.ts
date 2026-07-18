import { describe, expect, test } from "vitest";

import { healthResponse } from "./health";

describe("realtime health endpoint", () => {
  test("returns ok for the health path", async () => {
    const response = healthResponse("/health");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("returns not found for unrelated paths", () => {
    expect(healthResponse("/unknown").status).toBe(404);
  });
});
