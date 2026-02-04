/**
 * Claude Code provider configuration.
 * Installs hooks in ~/.claude/settings.json.
 *
 * Hooks are discovered from ${shakaHome}/system/hooks/*.ts
 * Each hook declares its trigger event via: TRIGGER: EventName
 */

import { type Result, err, ok } from "../../domain/result";
import { type HookEvent, SHAKA_TO_CLAUDE_EVENT, discoverHooks } from "../hook-discovery";
import type { HookConfig, HookVerificationResult, ProviderConfigurer } from "../types";

interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface ClaudeSettings {
  hooks?: {
    [key: string]: ClaudeHookEntry[] | undefined;
  };
  [key: string]: unknown;
}

export class ClaudeProviderConfigurer implements ProviderConfigurer {
  readonly name = "claude" as const;
  private readonly claudeHome: string;

  constructor(options?: { claudeHome?: string }) {
    this.claudeHome = options?.claudeHome ?? `${process.env.HOME}/.claude`;
  }

  async isInstalled(): Promise<boolean> {
    const proc = Bun.spawn(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return (await proc.exited) === 0;
  }

  async installHooks(config: HookConfig): Promise<Result<void, Error>> {
    try {
      const settingsPath = `${this.claudeHome}/settings.json`;
      let settings: ClaudeSettings = {};

      const file = Bun.file(settingsPath);
      if (await file.exists()) {
        settings = (await file.json()) as ClaudeSettings;
      }

      if (!settings.hooks) {
        settings.hooks = {};
      }

      const hooksDir = `${config.shakaHome}/system/hooks`;
      const discoveredHooks = await discoverHooks(hooksDir);

      // Group discovered hooks by Shaka event type
      const hooksByEvent = new Map<HookEvent, typeof discoveredHooks>();
      for (const hook of discoveredHooks) {
        const existing = hooksByEvent.get(hook.event) ?? [];
        existing.push(hook);
        hooksByEvent.set(hook.event, existing);
      }

      // Register all hooks for each event type
      // Convert Shaka event names to Claude Code event names
      for (const [shakaEvent, hooks] of hooksByEvent) {
        const claudeEvent = SHAKA_TO_CLAUDE_EVENT[shakaEvent];

        if (!Array.isArray(settings.hooks[claudeEvent])) {
          settings.hooks[claudeEvent] = [];
        }

        const eventHooks = settings.hooks[claudeEvent] as ClaudeHookEntry[];
        const existingShakaEntry = eventHooks.find((h) => h.matcher === "shaka");

        if (existingShakaEntry) {
          // Update existing entry with all hook commands
          existingShakaEntry.hooks = hooks.map((h) => ({
            type: "command",
            command: `bun ${h.path}`,
          }));
        } else {
          // Create new entry with all hooks
          eventHooks.push({
            matcher: "shaka",
            hooks: hooks.map((h) => ({ type: "command", command: `bun ${h.path}` })),
          });
        }
      }

      await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async uninstallHooks(): Promise<Result<void, Error>> {
    try {
      const settingsPath = `${this.claudeHome}/settings.json`;
      const file = Bun.file(settingsPath);

      if (await file.exists()) {
        const settings = (await file.json()) as ClaudeSettings;

        if (settings.hooks) {
          for (const eventName of Object.keys(settings.hooks)) {
            const eventHooks = settings.hooks[eventName];
            if (Array.isArray(eventHooks)) {
              settings.hooks[eventName] = eventHooks.filter((h) => h.matcher !== "shaka");
            }
          }
        }

        await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
      }

      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async verifyHooks(): Promise<HookVerificationResult> {
    const settingsPath = `${this.claudeHome}/settings.json`;
    const file = Bun.file(settingsPath);

    if (!(await file.exists())) {
      return { installed: false, issues: ["settings.json not found"] };
    }

    try {
      const settings = (await file.json()) as ClaudeSettings;
      const issue = this.findHookIssue(settings);
      return issue ? { installed: false, issues: [issue] } : { installed: true, issues: [] };
    } catch {
      return { installed: false, issues: ["Failed to parse settings.json"] };
    }
  }

  private findHookIssue(settings: ClaudeSettings): string | null {
    if (!settings.hooks || typeof settings.hooks !== "object") {
      return "No hooks configured";
    }

    const hasShakaHook = Object.values(settings.hooks).some(
      (eventHooks) => Array.isArray(eventHooks) && eventHooks.some((h) => h.matcher === "shaka"),
    );

    return hasShakaHook ? null : "No Shaka hooks configured";
  }
}
