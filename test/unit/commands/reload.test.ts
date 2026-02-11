import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProviderConfigurer } from "../../../src/providers/claude/configurer";

describe("reload (integration)", () => {
  const testClaudeHome = join(tmpdir(), "shaka-test-reload-claude");
  const testShakaHome = join(tmpdir(), "shaka-test-reload-shaka");

  beforeEach(async () => {
    await rm(testClaudeHome, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
    await mkdir(testClaudeHome, { recursive: true });
    await mkdir(`${testShakaHome}/system/hooks`, { recursive: true });

    await Bun.write(
      `${testShakaHome}/system/hooks/session-start.ts`,
      `export const TRIGGER = ["session.start"] as const;`,
    );
  });

  afterEach(async () => {
    await rm(testClaudeHome, { recursive: true, force: true });
    await rm(testShakaHome, { recursive: true, force: true });
  });

  test("reload picks up new hooks added to customizations/hooks/", async () => {
    const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });

    // Initial install — only system hooks
    await configurer.install({ shakaHome: testShakaHome });
    let settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();

    // Add a customization hook
    await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
    await Bun.write(
      `${testShakaHome}/customizations/hooks/my-hook.ts`,
      `export const TRIGGER = ["prompt.submit"] as const;`,
    );

    // Reload (same as calling install() again)
    await configurer.install({ shakaHome: testShakaHome });
    settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    const entry = settings.hooks.UserPromptSubmit.find((h: { matcher?: string }) => !h.matcher);
    expect(entry.hooks[0].command).toContain(join("customizations", "hooks", "my-hook.ts"));
  });

  test("reload picks up removed hooks", async () => {
    // Add a custom hook and install
    await mkdir(`${testShakaHome}/customizations/hooks`, { recursive: true });
    await Bun.write(
      `${testShakaHome}/customizations/hooks/temp-hook.ts`,
      `export const TRIGGER = ["prompt.submit"] as const;`,
    );
    const configurer = new ClaudeProviderConfigurer({ claudeHome: testClaudeHome });
    await configurer.install({ shakaHome: testShakaHome });

    let settings = await Bun.file(`${testClaudeHome}/settings.json`).json();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();

    // Remove the custom hook file
    await rm(`${testShakaHome}/customizations/hooks/temp-hook.ts`);

    // Reload — UserPromptSubmit should no longer have hooks
    await configurer.install({ shakaHome: testShakaHome });
    settings = await Bun.file(`${testClaudeHome}/settings.json`).json();

    // The event entry may still exist but should have no shaka hooks
    const entry = settings.hooks.UserPromptSubmit?.find((h: { matcher?: string }) => !h.matcher);
    // Entry is replaced with empty hooks since no hooks discovered for this event
    expect(entry).toBeUndefined();
  });
});
