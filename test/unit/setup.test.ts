import { describe, expect, test } from "bun:test";

describe("test infrastructure", () => {
  test("bun test runner works", () => {
    expect(1 + 1).toBe(2);
  });

  test("async tests work", async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});
