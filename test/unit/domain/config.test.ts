import { describe, expect, test } from "bun:test";
import {
  validateConfig,
  resolveShakaHome,
  type ShakaConfig,
} from "../../../src/domain/config";

describe("Config", () => {
  describe("validateConfig", () => {
    const validConfig: ShakaConfig = {
      version: "0.1.0",
      reasoning: { enabled: true },
      providers: {
        claude: { enabled: false },
        opencode: { enabled: false },
      },
      assistant: { name: "Shaka" },
      principal: { name: "User" },
    };

    test("returns ok for valid config", () => {
      const result = validateConfig(validConfig);
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

    test("returns error for missing version", () => {
      const { version: _, ...configWithoutVersion } = validConfig;
      const result = validateConfig(configWithoutVersion);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have version string");
      }
    });

    test("returns error for missing reasoning section", () => {
      const { reasoning: _, ...configWithoutReasoning } = validConfig;
      const result = validateConfig(configWithoutReasoning);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have reasoning section");
      }
    });

    test("returns error for missing providers section", () => {
      const { providers: _, ...configWithoutProviders } = validConfig;
      const result = validateConfig(configWithoutProviders);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have providers section");
      }
    });

    test("returns error for missing assistant section", () => {
      const { assistant: _, ...configWithoutAssistant } = validConfig;
      const result = validateConfig(configWithoutAssistant);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have assistant section");
      }
    });

    test("returns error for missing principal section", () => {
      const { principal: _, ...configWithoutPrincipal } = validConfig;
      const result = validateConfig(configWithoutPrincipal);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Config must have principal section");
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
