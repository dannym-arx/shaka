import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { OpencodeProviderConfigurer } from "../../../../src/providers/opencode/configurer";

describe("OpencodeProviderConfigurer", () => {
  const testProjectRoot = "/tmp/shaka-test-opencode-project";
  const testShakaHome = "/tmp/shaka-test-shaka";

  beforeEach(async () => {
    await rm(testProjectRoot, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
    await mkdir(testProjectRoot, { recursive: true });
    await mkdir(`${testShakaHome}/system/hooks`, { recursive: true });

    // Create test hooks with TRIGGER exports (Shaka canonical names)
    await Bun.write(
      `${testShakaHome}/system/hooks/session-start.ts`,
      `export const TRIGGER = ["session.start"] as const;
console.log(JSON.stringify({ hookSpecificOutput: { additionalContext: "test" } }));
`,
    );
  });

  afterEach(async () => {
    await rm(testProjectRoot, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
  });

  describe("name", () => {
    test("returns opencode", () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });
      expect(configurer.name).toBe("opencode");
    });
  });

  describe("installHooks", () => {
    test("creates .opencode/plugins directory", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      const result = await configurer.installHooks({ shakaHome: testShakaHome });

      expect(result.ok).toBe(true);
      const pluginFile = Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`);
      expect(await pluginFile.exists()).toBe(true);
    });

    test("creates shaka.ts plugin file", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const pluginFile = Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`);
      expect(await pluginFile.exists()).toBe(true);
      const content = await pluginFile.text();
      expect(content).toContain("SHAKA_HOME");
      expect(content).toContain(testShakaHome);
    });

    test("plugin includes discovered hooks in header comment", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const content = await Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`).text();
      expect(content).toContain("session-start.ts (session.start)");
    });

    test("plugin includes runHook helper function", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const content = await Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`).text();
      expect(content).toContain("async function runHook");
    });

    test("plugin includes system.transform hook for session.start", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const content = await Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`).text();
      expect(content).toContain("experimental.chat.system.transform");
    });

    test("discovers multiple hook types", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/format-reminder.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("format");
`,
      );
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const content = await Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`).text();
      expect(content).toContain("session-start.ts (session.start)");
      expect(content).toContain("format-reminder.ts (prompt.submit)");
    });
  });

  describe("uninstallHooks", () => {
    test("removes shaka.ts plugin file", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const result = await configurer.uninstallHooks();

      expect(result.ok).toBe(true);
      const pluginFile = Bun.file(`${testProjectRoot}/.opencode/plugins/shaka.ts`);
      expect(await pluginFile.exists()).toBe(false);
    });

    test("succeeds if plugin file does not exist", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      const result = await configurer.uninstallHooks();

      expect(result.ok).toBe(true);
    });
  });

  describe("verifyHooks", () => {
    test("returns installed: true when plugin exists", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const result = await configurer.verifyHooks();

      expect(result.installed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test("returns installed: false when plugin missing", async () => {
      const configurer = new OpencodeProviderConfigurer({ projectRoot: testProjectRoot });

      const result = await configurer.verifyHooks();

      expect(result.installed).toBe(false);
      expect(result.issues).toContain("shaka.ts plugin not found");
    });
  });
});
