import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import {
  type ShakaConfig,
  getAssistantName,
  getPrincipalName,
  isSubagent,
  loadConfig,
  loadShakaFile,
  resolveShakaHome,
  validateConfig,
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
      expect(() => resolveShakaHome({})).toThrow("HOME environment variable not set");
    });

    test("uses process.env when no argument provided", () => {
      // This test verifies the function works without explicit env
      const home = resolveShakaHome();
      expect(typeof home).toBe("string");
      expect(home.length).toBeGreaterThan(0);
    });
  });

  describe("loadConfig", () => {
    const testShakaHome = "/tmp/shaka-test-config";
    const validConfig: ShakaConfig = {
      version: "0.1.0",
      reasoning: { enabled: true },
      providers: {
        claude: { enabled: false },
        opencode: { enabled: false },
      },
      assistant: { name: "TestAssistant" },
      principal: { name: "TestUser" },
    };

    beforeEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
      await mkdir(testShakaHome, { recursive: true });
    });

    afterEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
    });

    test("returns config when valid config.json exists", async () => {
      await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(validConfig));

      const config = await loadConfig(testShakaHome);

      expect(config).not.toBeNull();
      expect(config?.version).toBe("0.1.0");
      expect(config?.assistant.name).toBe("TestAssistant");
    });

    test("returns null when config.json does not exist", async () => {
      const config = await loadConfig(testShakaHome);
      expect(config).toBeNull();
    });

    test("returns null when config.json is invalid JSON", async () => {
      await Bun.write(`${testShakaHome}/config.json`, "not valid json");

      const config = await loadConfig(testShakaHome);
      expect(config).toBeNull();
    });

    test("returns null when config.json fails validation", async () => {
      await Bun.write(`${testShakaHome}/config.json`, JSON.stringify({ invalid: true }));

      const config = await loadConfig(testShakaHome);
      expect(config).toBeNull();
    });
  });

  describe("loadShakaFile", () => {
    const testShakaHome = "/tmp/shaka-test-files";

    beforeEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
      await mkdir(`${testShakaHome}/system`, { recursive: true });
      await mkdir(`${testShakaHome}/customizations`, { recursive: true });
      await mkdir(`${testShakaHome}/user`, { recursive: true });
    });

    afterEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
    });

    test("loads file from system directory", async () => {
      await Bun.write(`${testShakaHome}/system/test.md`, "system content");

      const content = await loadShakaFile("system/test.md", testShakaHome);
      expect(content).toBe("system content");
    });

    test("loads customization override for system file", async () => {
      await Bun.write(`${testShakaHome}/system/test.md`, "system content");
      await Bun.write(`${testShakaHome}/customizations/test.md`, "custom content");

      const content = await loadShakaFile("system/test.md", testShakaHome);
      expect(content).toBe("custom content");
    });

    test("falls back to system file when no customization exists", async () => {
      await Bun.write(`${testShakaHome}/system/test.md`, "system content");

      const content = await loadShakaFile("system/test.md", testShakaHome);
      expect(content).toBe("system content");
    });

    test("loads non-system files directly", async () => {
      await Bun.write(`${testShakaHome}/user/data.md`, "user content");

      const content = await loadShakaFile("user/data.md", testShakaHome);
      expect(content).toBe("user content");
    });

    test("returns null for non-existent file", async () => {
      const content = await loadShakaFile("system/nonexistent.md", testShakaHome);
      expect(content).toBeNull();
    });
  });

  describe("getAssistantName", () => {
    const testShakaHome = "/tmp/shaka-test-assistant";

    beforeEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
      await mkdir(testShakaHome, { recursive: true });
    });

    afterEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
    });

    test("returns assistant name from config", async () => {
      const config: ShakaConfig = {
        version: "0.1.0",
        reasoning: { enabled: true },
        providers: { claude: { enabled: false }, opencode: { enabled: false } },
        assistant: { name: "TestBot" },
        principal: { name: "TestUser" },
      };
      await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(config));

      const name = await getAssistantName(testShakaHome);
      expect(name).toBe("TestBot");
    });

    test("returns default when config missing", async () => {
      const name = await getAssistantName(testShakaHome);
      expect(name).toBe("Shaka");
    });
  });

  describe("getPrincipalName", () => {
    const testShakaHome = "/tmp/shaka-test-principal";

    beforeEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
      await mkdir(testShakaHome, { recursive: true });
    });

    afterEach(async () => {
      await rm(testShakaHome, { recursive: true, force: true });
    });

    test("returns principal name from config", async () => {
      const config: ShakaConfig = {
        version: "0.1.0",
        reasoning: { enabled: true },
        providers: { claude: { enabled: false }, opencode: { enabled: false } },
        assistant: { name: "TestBot" },
        principal: { name: "Alice" },
      };
      await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(config));

      const name = await getPrincipalName(testShakaHome);
      expect(name).toBe("Alice");
    });

    test("returns default when config missing", async () => {
      const name = await getPrincipalName(testShakaHome);
      expect(name).toBe("User");
    });
  });

  describe("isSubagent", () => {
    test("returns false with empty env", () => {
      expect(isSubagent({})).toBe(false);
    });

    test("returns true when CLAUDE_AGENT_TYPE is set", () => {
      expect(isSubagent({ CLAUDE_AGENT_TYPE: "task" })).toBe(true);
    });

    test("returns true when CLAUDE_PROJECT_DIR contains /.claude/Agents/", () => {
      expect(isSubagent({ CLAUDE_PROJECT_DIR: "/home/user/.claude/Agents/task-123" })).toBe(true);
    });

    test("returns false when CLAUDE_PROJECT_DIR does not contain Agents", () => {
      expect(isSubagent({ CLAUDE_PROJECT_DIR: "/home/user/project" })).toBe(false);
    });

    test("returns true when OPENCODE_SUBAGENT is true", () => {
      expect(isSubagent({ OPENCODE_SUBAGENT: "true" })).toBe(true);
    });

    test("returns false when OPENCODE_SUBAGENT is not true", () => {
      expect(isSubagent({ OPENCODE_SUBAGENT: "false" })).toBe(false);
    });

    test("returns true when OPENCODE_AGENT_ID is set", () => {
      expect(isSubagent({ OPENCODE_AGENT_ID: "agent-123" })).toBe(true);
    });
  });
});
