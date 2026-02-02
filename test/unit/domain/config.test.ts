import { describe, expect, test } from "bun:test";
import {
  createDefaultConfig,
  validateConfig,
  resolveShakaHome,
  type ShakaConfig,
} from "../../../src/domain/config";

describe("Config", () => {
  describe("createDefaultConfig", () => {
    test("creates config with default values", () => {
      const config = createDefaultConfig();

      expect(config.reasoning.enabled).toBe(true);
      // Providers default to false - detection enables them at runtime
      expect(config.providers.claude.enabled).toBe(false);
      expect(config.providers.opencode.enabled).toBe(false);
    });
  });

  describe("validateConfig", () => {
    test("returns ok for valid config", () => {
      const config = createDefaultConfig();
      const result = validateConfig(config);

      expect(result.ok).toBe(true);
    });

    test("returns error for null config", () => {
      const result = validateConfig(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must be an object");
      }
    });

    test("returns error for non-object config", () => {
      const result = validateConfig("not an object");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must be an object");
      }
    });

    test("returns error for missing reasoning section", () => {
      const config = { providers: {} };
      const result = validateConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have reasoning section");
      }
    });

    test("returns error for missing providers section", () => {
      const config = { reasoning: { enabled: true } };
      const result = validateConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have providers section");
      }
    });
  });

  describe("resolveShakaHome", () => {
    test("uses SHAKA_HOME env var if set", () => {
      const home = resolveShakaHome({ SHAKA_HOME: "/custom/shaka" });

      expect(home).toBe("/custom/shaka");
    });

    test("uses XDG_CONFIG_HOME if set", () => {
      const home = resolveShakaHome({
        XDG_CONFIG_HOME: "/custom/config",
        HOME: "/home/user",
      });

      expect(home).toBe("/custom/config/shaka");
    });

    test("falls back to ~/.config/shaka", () => {
      const home = resolveShakaHome({ HOME: "/home/user" });

      expect(home).toBe("/home/user/.config/shaka");
    });

    test("throws if HOME not set", () => {
      expect(() => resolveShakaHome({})).toThrow(
        "HOME environment variable not set"
      );
    });
  });
});
