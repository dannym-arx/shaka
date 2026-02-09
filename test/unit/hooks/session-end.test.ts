import { describe, expect, test } from "bun:test";

describe("session-end hook", () => {
  test("exports TRIGGER with session.end", async () => {
    const mod = await import("../../../defaults/system/hooks/session-end.ts");
    expect(mod.TRIGGER).toEqual(["session.end"]);
  });

  test("exports HOOK_VERSION string", async () => {
    const mod = await import("../../../defaults/system/hooks/session-end.ts");
    expect(typeof mod.HOOK_VERSION).toBe("string");
    expect(mod.HOOK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("does not execute main on import (import.meta.main guard)", async () => {
    // If main() ran on import, it would try to read stdin and hang or crash.
    // The fact that this import completes without error proves the guard works.
    const mod = await import("../../../defaults/system/hooks/session-end.ts");
    expect(mod.TRIGGER).toBeDefined();
  });

  test("source file contains import.meta.main guard", async () => {
    const source = await Bun.file("defaults/system/hooks/session-end.ts").text();
    expect(source).toContain("import.meta.main");
  });

  test("source file imports from shaka package", async () => {
    const source = await Bun.file("defaults/system/hooks/session-end.ts").text();
    expect(source).toContain('from "shaka"');
  });

  test("source file uses fail-open pattern (exits 0 on error)", async () => {
    const source = await Bun.file("defaults/system/hooks/session-end.ts").text();
    // Should have catch blocks that exit 0
    expect(source).toContain("process.exit(0)");
    expect(source).toContain("catch");
  });
});
