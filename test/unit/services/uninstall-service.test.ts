import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { ok } from "../../../src/domain/result";
import { InitService } from "../../../src/services/init-service";
import { UninstallService } from "../../../src/services/uninstall-service";
import type { Result } from "../../../src/domain/result";

describe("UninstallService", () => {
  const testHome = "/tmp/shaka-test-uninstall";
  const defaultsPath = new URL("../../../defaults", import.meta.url).pathname;

  const mockBunLink = async (): Promise<Result<void, Error>> => ok(undefined);

  /** Set up a fully initialized shaka home for testing uninstall. */
  async function setupInitializedHome(
    providers: { claude: boolean; opencode: boolean } = { claude: true, opencode: false },
  ) {
    const initService = new InitService({
      shakaHome: testHome,
      defaultsPath,
      detectProviders: async () => providers,
      runBunLink: mockBunLink,
    });
    const result = await initService.init();
    if (!result.ok) throw new Error(`Init failed: ${result.error.message}`);
    return result.value;
  }

  function createService(
    overrides: { detectProviders?: () => Promise<{ claude: boolean; opencode: boolean }> } = {},
  ) {
    return new UninstallService({
      shakaHome: testHome,
      detectProviders: overrides.detectProviders ?? (async () => ({ claude: false, opencode: false })),
    });
  }

  beforeEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  describe("removeSystemLink", () => {
    test("removes system/ symlink", async () => {
      await setupInitializedHome();
      const service = createService();

      const result = await service.removeSystemLink();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);

      // Verify symlink is gone
      try {
        await lstat(`${testHome}/system`);
        throw new Error("system/ should not exist");
      } catch (e: unknown) {
        expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    test("does not remove real directory", async () => {
      await mkdir(`${testHome}/system`, { recursive: true });
      const service = createService();

      const result = await service.removeSystemLink();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);

      // Real directory still exists
      const stats = await lstat(`${testHome}/system`);
      expect(stats.isDirectory()).toBe(true);
    });

    test("returns false when nothing exists", async () => {
      await mkdir(testHome, { recursive: true });
      const service = createService();

      const result = await service.removeSystemLink();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });
  });

  describe("removeFrameworkFiles", () => {
    test("removes .shaka-version and config.json", async () => {
      await setupInitializedHome();
      const service = createService();

      // Verify files exist before
      expect(await Bun.file(`${testHome}/.shaka-version`).exists()).toBe(true);
      expect(await Bun.file(`${testHome}/config.json`).exists()).toBe(true);

      const removed = await service.removeFrameworkFiles();

      expect(removed).toContain(`${testHome}/.shaka-version`);
      expect(removed).toContain(`${testHome}/config.json`);

      // Verify files are gone
      expect(await Bun.file(`${testHome}/.shaka-version`).exists()).toBe(false);
      expect(await Bun.file(`${testHome}/config.json`).exists()).toBe(false);
    });

    test("handles missing files gracefully", async () => {
      await mkdir(testHome, { recursive: true });
      const service = createService();

      const removed = await service.removeFrameworkFiles();

      expect(removed).toEqual([]);
    });
  });

  describe("removeUserData", () => {
    test("removes user/, customizations/, memory/", async () => {
      await setupInitializedHome();
      // Add some user content
      await writeFile(`${testHome}/user/about-me.md`, "custom content");

      const service = createService();
      const removed = await service.removeUserData();

      expect(removed).toContain(`${testHome}/user`);
      expect(removed).toContain(`${testHome}/customizations`);
      expect(removed).toContain(`${testHome}/memory`);
    });

    test("handles missing directories gracefully", async () => {
      await mkdir(testHome, { recursive: true });
      const service = createService();

      const removed = await service.removeUserData();

      expect(removed).toEqual([]);
    });
  });

  describe("removeShakaHomeIfEmpty", () => {
    test("removes empty shakaHome", async () => {
      await mkdir(testHome, { recursive: true });
      const service = createService();

      const removed = await service.removeShakaHomeIfEmpty();

      expect(removed).toBe(true);
    });

    test("keeps non-empty shakaHome", async () => {
      await mkdir(testHome, { recursive: true });
      await writeFile(`${testHome}/leftover.txt`, "data");
      const service = createService();

      const removed = await service.removeShakaHomeIfEmpty();

      expect(removed).toBe(false);
    });
  });

  describe("uninstall", () => {
    test("removes framework files but keeps user data by default", async () => {
      await setupInitializedHome();
      const service = createService();

      const result = await service.uninstall({ deleteUserData: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Framework items removed
        expect(result.value.removed).toContain(`${testHome}/system`);
        expect(result.value.removed).toContain(`${testHome}/.shaka-version`);
        expect(result.value.removed).toContain(`${testHome}/config.json`);

        // User dirs still exist
        const userStats = await lstat(`${testHome}/user`);
        expect(userStats.isDirectory()).toBe(true);
      }
    });

    test("removes everything when deleteUserData is true", async () => {
      await setupInitializedHome();
      const service = createService();

      const result = await service.uninstall({ deleteUserData: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.removed).toContain(`${testHome}/user`);
        expect(result.value.removed).toContain(`${testHome}/customizations`);
        expect(result.value.removed).toContain(`${testHome}/memory`);

        // shakaHome itself should be removed (now empty)
        expect(result.value.removed).toContain(testHome);
      }
    });

    test("reports provider uninstall status", async () => {
      await setupInitializedHome({ claude: true, opencode: false });
      // No actual provider installed in test env, so detection returns false
      const service = createService({
        detectProviders: async () => ({ claude: false, opencode: false }),
      });

      const result = await service.uninstall({ deleteUserData: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providers.claude.detected).toBe(false);
        expect(result.value.providers.opencode.detected).toBe(false);
      }
    });
  });
});
