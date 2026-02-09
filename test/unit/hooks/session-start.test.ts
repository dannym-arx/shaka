import { describe, expect, test } from "bun:test";

describe("session-start hook", () => {
  test("exports TRIGGER with session.start", async () => {
    const mod = await import("../../../defaults/system/hooks/session-start.ts");
    expect(mod.TRIGGER).toEqual(["session.start"]);
  });

  test("source file imports memory functions from shaka", async () => {
    const source = await Bun.file("defaults/system/hooks/session-start.ts").text();
    expect(source).toContain("listSummaries");
    expect(source).toContain("selectRecentSummaries");
  });

  test("source file includes Recent Sessions header", async () => {
    const source = await Bun.file("defaults/system/hooks/session-start.ts").text();
    expect(source).toContain("Recent Sessions");
  });

  test("source file includes memory size cap", async () => {
    const source = await Bun.file("defaults/system/hooks/session-start.ts").text();
    // Should have a constant or logic for capping memory section size
    expect(source).toMatch(/MAX_MEMORY|5.*KB|5000|5120/i);
  });
});
