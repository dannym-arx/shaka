import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { ClaudeProviderConfigurer } from "../../../../src/providers/claude/configurer";
import {
  HOOK_EVENTS,
  SHAKA_TO_CLAUDE_EVENT,
  SHAKA_TO_OPENCODE_HOOK,
  discoverAllHooks,
  discoverHooks,
  parseHookTrigger,
} from "../../../../src/providers/hook-discovery";

describe("ClaudeProviderConfigurer", () => {
  const testClaudeHome = "/tmp/shaka-test-claude";
  const testShakaHome = "/tmp/shaka-test-shaka";

  beforeEach(async () => {
    await rm(testClaudeHome, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
    await mkdir(testClaudeHome, { recursive: true });
    await mkdir(`${testShakaHome}/system/hooks`, { recursive: true });

    // Create a test hook with TRIGGER export (Shaka canonical names)
    await Bun.write(
      `${testShakaHome}/system/hooks/session-start.ts`,
      `export const TRIGGER = ["session.start"] as const;
console.log("test");
`,
    );
  });

  afterEach(async () => {
    await rm(testClaudeHome, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
  });

  describe("name", () => {
    test("returns claude", () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
      expect(configurer.name).toBe("claude");
    });
  });

  describe("installHooks", () => {
    test("creates settings.json if it does not exist", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      const result = await configurer.installHooks({ shakaHome: testShakaHome });

      expect(result.ok).toBe(true);
      const settingsFile = Bun.file(`${testClaudeHome}/settings.json`);
      expect(await settingsFile.exists()).toBe(true);
    });

    test("adds discovered hook entries", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
    });

    test("preserves existing settings", async () => {
      await Bun.write(
        `${testClaudeHome}/settings.json`,
        JSON.stringify({ existingKey: "existingValue" }),
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      expect(settings.existingKey).toBe("existingValue");
      expect(settings.hooks).toBeDefined();
    });

    test("does not duplicate hook if already exists", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const shakaHooks = settings.hooks.SessionStart.filter(
        (h: { matcher?: string }) => !h.matcher,
      );
      expect(shakaHooks.length).toBe(1);
    });

    test("registers SessionEnd hooks for session.end trigger", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/session-end.ts`,
        `export const TRIGGER = ["session.end"] as const;
console.log("test");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.SessionEnd.length).toBeGreaterThan(0);
      const shakaEntry = settings.hooks.SessionEnd.find((h: { matcher?: string }) => !h.matcher);
      expect(shakaEntry).toBeDefined();
      expect(shakaEntry.hooks[0].command).toContain("session-end.ts");
    });

    test("installs multiple hooks for different events", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/format-reminder.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("format");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
    });

    test("registers all hooks when multiple hooks have same event type", async () => {
      // Create two hooks with same TRIGGER (Shaka canonical names)
      await Bun.write(
        `${testShakaHome}/system/hooks/hook-a.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("hook-a");
`,
      );
      await Bun.write(
        `${testShakaHome}/system/hooks/hook-b.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("hook-b");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const shakaEntry = settings.hooks.UserPromptSubmit.find(
        (h: { matcher?: string }) => !h.matcher,
      );
      expect(shakaEntry).toBeDefined();
      expect(shakaEntry.hooks).toHaveLength(2);
      expect(shakaEntry.hooks.map((h: { command: string }) => h.command)).toContain(
        `bun run ${testShakaHome}/system/hooks/hook-a.ts`,
      );
      expect(shakaEntry.hooks.map((h: { command: string }) => h.command)).toContain(
        `bun run ${testShakaHome}/system/hooks/hook-b.ts`,
      );
    });

    test("registers hooks with matchers under tool-specific entries", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/security.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash", "Edit"] as const;
console.log("security");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const bashEntry = settings.hooks.PreToolUse.find(
        (h: { matcher?: string }) => h.matcher === "Bash",
      );
      const editEntry = settings.hooks.PreToolUse.find(
        (h: { matcher?: string }) => h.matcher === "Edit",
      );

      expect(bashEntry).toBeDefined();
      expect(bashEntry.hooks).toHaveLength(1);
      expect(bashEntry.hooks[0].command).toBe(`bun run ${testShakaHome}/system/hooks/security.ts`);

      expect(editEntry).toBeDefined();
      expect(editEntry.hooks).toHaveLength(1);
      expect(editEntry.hooks[0].command).toBe(`bun run ${testShakaHome}/system/hooks/security.ts`);
    });

    test("handles mixed hooks with and without matchers", async () => {
      // Hook with matchers
      await Bun.write(
        `${testShakaHome}/system/hooks/security.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash"] as const;
console.log("security");
`,
      );
      // Hook without matchers (same event)
      await Bun.write(
        `${testShakaHome}/system/hooks/logger.ts`,
        `export const TRIGGER = ["tool.before"] as const;
console.log("logger");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();

      // Bash matcher should have security hook
      const bashEntry = settings.hooks.PreToolUse.find(
        (h: { matcher?: string }) => h.matcher === "Bash",
      );
      expect(bashEntry).toBeDefined();
      expect(bashEntry.hooks[0].command).toContain("security.ts");

      // No-matcher entry should have logger hook (catch-all)
      const catchAllEntry = settings.hooks.PreToolUse.find((h: { matcher?: string }) => !h.matcher);
      expect(catchAllEntry).toBeDefined();
      expect(catchAllEntry.hooks[0].command).toContain("logger.ts");
    });

    test("multiple hooks targeting same matcher are grouped together", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/security-a.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash"] as const;
`,
      );
      await Bun.write(
        `${testShakaHome}/system/hooks/security-b.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash"] as const;
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const bashEntry = settings.hooks.PreToolUse.find(
        (h: { matcher?: string }) => h.matcher === "Bash",
      );

      expect(bashEntry).toBeDefined();
      expect(bashEntry.hooks).toHaveLength(2);
    });

    test("discovers hooks from customizations/hooks/ directory", async () => {
      await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
      await Bun.write(
        `${testShakaHome}/customizations/hooks/custom-prompt.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("custom");
`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      await configurer.installHooks({ shakaHome: testShakaHome });

      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      const catchAll = settings.hooks.UserPromptSubmit.find(
        (h: { matcher?: string }) => !h.matcher,
      );
      expect(catchAll).toBeDefined();
      expect(catchAll.hooks[0].command).toContain("customizations/hooks/custom-prompt.ts");
    });
  });

  describe("uninstallHooks", () => {
    test("removes shaka hooks from all events", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const result = await configurer.uninstallHooks();

      expect(result.ok).toBe(true);
      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const remaining = (settings.hooks?.SessionStart ?? []).filter(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some((hook) => hook.command?.includes("/system/hooks/")),
      );
      expect(remaining.length).toBe(0);
    });

    test("removes customization hooks during uninstall", async () => {
      await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
      await Bun.write(
        `${testShakaHome}/customizations/hooks/custom.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;`,
      );
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const result = await configurer.uninstallHooks();

      expect(result.ok).toBe(true);
      const settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
      const remaining = (settings.hooks?.UserPromptSubmit ?? []).filter(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some((hook) => hook.command?.includes("/customizations/hooks/")),
      );
      expect(remaining.length).toBe(0);
    });

    test("succeeds if settings.json does not exist", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      const result = await configurer.uninstallHooks();

      expect(result.ok).toBe(true);
    });
  });

  describe("verifyHooks", () => {
    test("returns installed: true when hooks are configured", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
      await configurer.installHooks({ shakaHome: testShakaHome });

      const result = await configurer.verifyHooks();

      expect(result.installed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test("returns installed: false when settings.json missing", async () => {
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
      await rm(`${testClaudeHome}/settings.json`, { force: true });

      const result = await configurer.verifyHooks();

      expect(result.installed).toBe(false);
      expect(result.issues).toContain("settings.json not found");
    });

    test("returns installed: false when no shaka hooks configured", async () => {
      await Bun.write(`${testClaudeHome}/settings.json`, JSON.stringify({ hooks: {} }));
      const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

      const result = await configurer.verifyHooks();

      expect(result.installed).toBe(false);
      expect(result.issues).toContain("No Shaka hooks configured");
    });
  });

  describe("registerMcpServer", () => {
    test("calls claude mcp add with correct arguments", async () => {
      const calls: string[][] = [];
      const mockRunCommand = async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stderr: "" };
      };
      const configurer = new ClaudeProviderConfigurer({
        claudeHome: testClaudeHome,
        runCommand: mockRunCommand,
      });

      const result = await configurer.registerMcpServer();

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        "claude",
        "mcp",
        "add",
        "shaka",
        "-s",
        "user",
        "--",
        "shaka",
        "mcp",
        "serve",
      ]);
    });

    test("returns error when claude mcp add fails", async () => {
      const mockRunCommand = async () => ({
        exitCode: 1,
        stderr: "command not found",
      });
      const configurer = new ClaudeProviderConfigurer({
        claudeHome: testClaudeHome,
        runCommand: mockRunCommand,
      });

      const result = await configurer.registerMcpServer();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("claude mcp add failed");
      }
    });
  });

  describe("unregisterMcpServer", () => {
    test("calls claude mcp remove with correct arguments", async () => {
      const calls: string[][] = [];
      const mockRunCommand = async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stderr: "" };
      };
      const configurer = new ClaudeProviderConfigurer({
        claudeHome: testClaudeHome,
        runCommand: mockRunCommand,
      });

      const result = await configurer.unregisterMcpServer();

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(["claude", "mcp", "remove", "shaka", "-s", "user"]);
    });

    test("succeeds even if server not found", async () => {
      const mockRunCommand = async () => ({
        exitCode: 1,
        stderr: "Server shaka not found",
      });
      const configurer = new ClaudeProviderConfigurer({
        claudeHome: testClaudeHome,
        runCommand: mockRunCommand,
      });

      const result = await configurer.unregisterMcpServer();

      expect(result.ok).toBe(true);
    });
  });
});

describe("Hook Discovery (shared)", () => {
  const testShakaHome = "/tmp/shaka-test-discovery";

  beforeEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
    await mkdir(`${testShakaHome}/system/hooks`, { recursive: true });

    // Use Shaka canonical names
    await Bun.write(
      `${testShakaHome}/system/hooks/session-start.ts`,
      `export const TRIGGER = ["session.start"] as const;
console.log("test");
`,
    );
  });

  afterEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
  });

  describe("HOOK_EVENTS", () => {
    test("includes session.end", () => {
      expect(HOOK_EVENTS).toContain("session.end");
    });
  });

  describe("SHAKA_TO_CLAUDE_EVENT", () => {
    test("maps session.end to SessionEnd", () => {
      expect(SHAKA_TO_CLAUDE_EVENT["session.end"]).toBe("SessionEnd");
    });
  });

  describe("SHAKA_TO_OPENCODE_HOOK", () => {
    test("maps session.end to null (special handling)", () => {
      expect(SHAKA_TO_OPENCODE_HOOK["session.end"]).toBeNull();
    });
  });

  describe("parseHookTrigger", () => {
    test("extracts triggers from exported array", async () => {
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/session-start.ts`);
      expect(result.events).toEqual(["session.start"]);
      expect(result.matchers).toBeUndefined();
    });

    test("extracts multiple triggers", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/multi-trigger.ts`,
        `export const TRIGGER = ["session.start", "prompt.submit"] as const;`,
      );
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/multi-trigger.ts`);
      expect(result.events).toEqual(["session.start", "prompt.submit"]);
    });

    test("extracts matchers when present", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/with-matchers.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash", "Edit"] as const;`,
      );
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/with-matchers.ts`);
      expect(result.events).toEqual(["tool.before"]);
      expect(result.matchers).toEqual(["Bash", "Edit"]);
    });

    test("returns empty events for file without TRIGGER export", async () => {
      await Bun.write(`${testShakaHome}/system/hooks/no-trigger.ts`, "console.log('no trigger');");
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/no-trigger.ts`);
      expect(result.events).toEqual([]);
    });

    test("filters out invalid TRIGGER values", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/invalid-trigger.ts`,
        `export const TRIGGER = ["InvalidEvent", "session.start"] as const;`,
      );
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/invalid-trigger.ts`);
      expect(result.events).toEqual(["session.start"]);
    });

    test("returns empty events for non-array TRIGGER", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/string-trigger.ts`,
        `export const TRIGGER = "session.start" as const;`,
      );
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/string-trigger.ts`);
      expect(result.events).toEqual([]);
    });

    test("returns empty events for non-existent file", async () => {
      const result = await parseHookTrigger(`${testShakaHome}/system/hooks/nonexistent.ts`);
      expect(result.events).toEqual([]);
    });
  });

  describe("discoverHooks", () => {
    test("discovers hooks with TRIGGER export", async () => {
      const hooks = await discoverHooks(`${testShakaHome}/system/hooks`);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.event).toBe("session.start");
      expect(hooks[0]?.filename).toBe("session-start.ts");
    });

    test("ignores files without TRIGGER export", async () => {
      await Bun.write(`${testShakaHome}/system/hooks/no-trigger.ts`, "console.log('no trigger');");
      const hooks = await discoverHooks(`${testShakaHome}/system/hooks`);
      expect(hooks).toHaveLength(1);
    });

    test("discovers multiple hooks", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/format-reminder.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;
console.log("format");
`,
      );
      const hooks = await discoverHooks(`${testShakaHome}/system/hooks`);
      expect(hooks).toHaveLength(2);
      expect(hooks.map((h) => h.event).sort()).toEqual(["prompt.submit", "session.start"]);
    });

    test("returns empty array for non-existent directory", async () => {
      const hooks = await discoverHooks("/nonexistent/path");
      expect(hooks).toEqual([]);
    });

    test("creates multiple entries for hook with multiple triggers", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/multi-event.ts`,
        `export const TRIGGER = ["session.start", "prompt.submit"] as const;
console.log("multi");
`,
      );
      const hooks = await discoverHooks(`${testShakaHome}/system/hooks`);
      const multiEventHooks = hooks.filter((h) => h.filename === "multi-event.ts");
      expect(multiEventHooks).toHaveLength(2);
      expect(multiEventHooks.map((h) => h.event).sort()).toEqual([
        "prompt.submit",
        "session.start",
      ]);
    });

    test("discovers hooks with matchers", async () => {
      await Bun.write(
        `${testShakaHome}/system/hooks/security-validator.ts`,
        `export const TRIGGER = ["tool.before"] as const;
export const MATCHER = ["Bash", "Edit", "Write"] as const;
console.log("security");
`,
      );
      const hooks = await discoverHooks(`${testShakaHome}/system/hooks`);
      const securityHooks = hooks.filter((h) => h.filename === "security-validator.ts");
      expect(securityHooks).toHaveLength(1);
      expect(securityHooks[0]?.event).toBe("tool.before");
      expect(securityHooks[0]?.matchers).toEqual(["Bash", "Edit", "Write"]);
    });
  });

  describe("discoverAllHooks", () => {
    test("discovers hooks from system/hooks/", async () => {
      const hooks = await discoverAllHooks(testShakaHome);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.event).toBe("session.start");
    });

    test("discovers hooks from customizations/hooks/", async () => {
      await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
      await Bun.write(
        `${testShakaHome}/customizations/hooks/custom-hook.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;`,
      );

      const hooks = await discoverAllHooks(testShakaHome);
      expect(hooks).toHaveLength(2);
      expect(hooks.map((h) => h.event).sort()).toEqual(["prompt.submit", "session.start"]);
    });

    test("appends hooks with unique filenames from customizations/", async () => {
      await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
      await Bun.write(
        `${testShakaHome}/customizations/hooks/extra.ts`,
        `export const TRIGGER = ["session.start"] as const;`,
      );

      const hooks = await discoverAllHooks(testShakaHome);
      const sessionStartHooks = hooks.filter((h) => h.event === "session.start");
      expect(sessionStartHooks).toHaveLength(2);
    });

    test("customization hook overrides system hook with same filename", async () => {
      await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
      await Bun.write(
        `${testShakaHome}/customizations/hooks/session-start.ts`,
        `export const TRIGGER = ["prompt.submit"] as const;`,
      );

      const hooks = await discoverAllHooks(testShakaHome);
      // System session-start.ts (session.start) replaced by custom (prompt.submit)
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.event).toBe("prompt.submit");
      expect(hooks[0]?.path).toContain("/customizations/hooks/");
    });

    test("works when customizations/hooks/ does not exist", async () => {
      const hooks = await discoverAllHooks(testShakaHome);
      // Should still find system hooks without error
      expect(hooks).toHaveLength(1);
    });

    test("works when system/hooks/ does not exist", async () => {
      const emptyHome = "/tmp/shaka-test-empty-home";
      await rm(emptyHome, { recursive: true, force: true });
      await mkdir(emptyHome, { recursive: true });

      const hooks = await discoverAllHooks(emptyHome);
      expect(hooks).toEqual([]);

      await rm(emptyHome, { recursive: true, force: true });
    });
  });
});
