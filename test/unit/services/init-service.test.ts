import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { InitService } from "../../../src/services/init-service";

describe("InitService", () => {
  const testHome = "/tmp/shaka-test-init";
  // Use actual defaults directory for tests
  const defaultsPath = new URL("../../../defaults", import.meta.url).pathname;

  beforeEach(async () => {
    // Clean up before each test
    await rm(testHome, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up after each test
    await rm(testHome, { recursive: true, force: true });
  });

  describe("createDirectories", () => {
    test("creates all required directories", async () => {
      const service = new InitService({ shakaHome: testHome, defaultsPath });

      const result = await service.createDirectories();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(testHome);
        expect(result.value).toContain(`${testHome}/user`);
        expect(result.value).toContain(`${testHome}/system`);
        expect(result.value).toContain(`${testHome}/system/hooks`);
        expect(result.value).toContain(`${testHome}/system/tools`);
        expect(result.value).toContain(`${testHome}/customizations`);
      }
    });

    test("is idempotent (can run multiple times)", async () => {
      const service = new InitService({ shakaHome: testHome, defaultsPath });

      const result1 = await service.createDirectories();
      const result2 = await service.createDirectories();

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });
  });

  describe("copyDefaultFiles", () => {
    test("creates config.json if not exists", async () => {
      const service = new InitService({ shakaHome: testHome, defaultsPath });
      await service.createDirectories();

      const result = await service.copyDefaultFiles();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(`${testHome}/config.json`);
      }

      // Verify file exists and is valid JSON
      const file = Bun.file(`${testHome}/config.json`);
      expect(await file.exists()).toBe(true);

      const content = await file.json();
      expect(content.version).toBe("0.1.0");
      expect(content.reasoning.enabled).toBe(true);
    });

    test("does not overwrite existing config.json", async () => {
      const service = new InitService({ shakaHome: testHome, defaultsPath });
      await service.createDirectories();

      // Create existing config
      const existingContent = '{"version": "custom"}';
      await Bun.write(`${testHome}/config.json`, existingContent);

      const result = await service.copyDefaultFiles();

      expect(result.ok).toBe(true);
      // Should not be in the list of created files
      if (result.ok) {
        expect(result.value).not.toContain(`${testHome}/config.json`);
      }

      // Content should be unchanged
      const content = await Bun.file(`${testHome}/config.json`).text();
      expect(content).toBe(existingContent);
    });
  });

  describe("init", () => {
    test("returns error when no providers detected and none specified", async () => {
      const service = new InitService({
        shakaHome: testHome,
        defaultsPath,
        detectProviders: async () => ({ claude: false, opencode: false }),
      });

      const result = await service.init();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("No AI providers detected");
      }
    });

    test("succeeds when at least one provider is detected", async () => {
      const service = new InitService({
        shakaHome: testHome,
        defaultsPath,
        detectProviders: async () => ({ claude: true, opencode: false }),
      });

      const result = await service.init();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providers.claude.detected).toBe(true);
        expect(result.value.providers.opencode.detected).toBe(false);
      }
    });

    test("creates directories and files on success", async () => {
      const service = new InitService({
        shakaHome: testHome,
        defaultsPath,
        detectProviders: async () => ({ claude: true, opencode: false }),
      });

      const result = await service.init();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.directories.length).toBeGreaterThan(0);
        expect(result.value.files.length).toBeGreaterThan(0);
      }
    });

    test("respects --provider flag to target specific provider", async () => {
      const service = new InitService({
        shakaHome: testHome,
        defaultsPath,
        detectProviders: async () => ({ claude: true, opencode: true }),
      });

      const result = await service.init({ provider: "claude" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providers.claude.installed).toBe(true);
        expect(result.value.providers.opencode.installed).toBe(false);
      }
    });

    test("returns error if specified provider is not installed", async () => {
      const service = new InitService({
        shakaHome: testHome,
        defaultsPath,
        detectProviders: async () => ({ claude: false, opencode: true }),
      });

      const result = await service.init({ provider: "claude" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("not installed");
      }
    });
  });
});
