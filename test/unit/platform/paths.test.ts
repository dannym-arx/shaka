import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveFromModule } from "../../../src/platform/paths";

describe("platform/paths", () => {
  describe("resolveFromModule", () => {
    test("resolves relative path from module URL", () => {
      const result = resolveFromModule(import.meta.url, "./fixtures");
      expect(result).toContain("test");
      expect(result).toContain("fixtures");
    });

    test("resolves parent directory traversal", () => {
      const result = resolveFromModule(import.meta.url, "../..");
      // Should resolve to test/ directory
      expect(result).toContain("test");
    });

    test("returns a valid filesystem path (no leading /C: on Windows)", () => {
      const result = resolveFromModule(import.meta.url, ".");
      // On Windows, should not start with /C:
      // On Unix, should start with /
      if (process.platform === "win32") {
        expect(result).not.toMatch(/^\/[A-Z]:/);
        expect(result).toMatch(/^[A-Z]:\\/);
      } else {
        expect(result).toMatch(/^\//);
      }
    });

    test("matches fileURLToPath behavior for known URL", () => {
      const base = pathToFileURL(join("/", "fake", "module.ts")).href;
      const result = resolveFromModule(base, "./sibling.ts");
      expect(result).toBe(join("/", "fake", "sibling.ts"));
    });
  });
});
