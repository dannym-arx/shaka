/**
 * Claude Code provider configuration.
 * Installs hooks in ~/.claude/settings.json.
 *
 * Hooks are discovered from ${shakaHome}/system/hooks/*.ts
 * Each hook declares its trigger event via: TRIGGER: EventName
 */

import { type Result, err, ok } from "../../domain/result";
import {
  type DiscoveredHook,
  type HookEvent,
  SHAKA_TO_CLAUDE_EVENT,
  discoverHooks,
} from "../hook-discovery";
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

/**
 * Register hooks for a specific matcher, replacing any existing hooks for that matcher.
 * This ensures the settings always reflect the current discovered state.
 */
function registerHooksForMatcher(
  eventHooks: ClaudeHookEntry[],
  matcher: string,
  hookPaths: string[],
): void {
  if (hookPaths.length === 0) return;

  const hookCommands = hookPaths.map((path) => ({
    type: "command",
    command: `bun ${path}`,
  }));

  const existingEntry = eventHooks.find((h) => h.matcher === matcher);
  if (existingEntry) {
    existingEntry.hooks = hookCommands;
  } else {
    eventHooks.push({ matcher, hooks: hookCommands });
  }
}

/**
 * Register hooks with tool-specific matchers (e.g., Bash, Edit).
 * Groups hooks by matcher, then registers each group.
 */
function registerHooksWithMatchers(eventHooks: ClaudeHookEntry[], hooks: DiscoveredHook[]): void {
  // Group hooks by matcher
  const hooksByMatcher = new Map<string, string[]>();
  for (const hook of hooks) {
    for (const matcher of hook.matchers ?? []) {
      const paths = hooksByMatcher.get(matcher) ?? [];
      paths.push(hook.path);
      hooksByMatcher.set(matcher, paths);
    }
  }

  // Register each matcher's hooks
  for (const [matcher, paths] of hooksByMatcher) {
    registerHooksForMatcher(eventHooks, matcher, paths);
  }
}

/**
 * Register hooks without matchers using "shaka" as generic matcher.
 */
function registerHooksWithoutMatchers(
  eventHooks: ClaudeHookEntry[],
  hooks: DiscoveredHook[],
): void {
  const paths = hooks.map((h) => h.path);
  registerHooksForMatcher(eventHooks, "shaka", paths);
}

/**
 * Group hooks by their event type.
 */
function groupHooksByEvent(hooks: DiscoveredHook[]): Map<HookEvent, DiscoveredHook[]> {
  const hooksByEvent = new Map<HookEvent, DiscoveredHook[]>();

  for (const hook of hooks) {
    const existing = hooksByEvent.get(hook.event) ?? [];
    existing.push(hook);
    hooksByEvent.set(hook.event, existing);
  }

  return hooksByEvent;
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
      const settings = await this.loadSettings();
      if (!settings.hooks) {
        settings.hooks = {};
      }

      const hooksDir = `${config.shakaHome}/system/hooks`;
      const discoveredHooks = await discoverHooks(hooksDir);
      const hooksByEvent = groupHooksByEvent(discoveredHooks);

      this.registerAllHooks(settings, hooksByEvent);

      await this.saveSettings(settings);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async loadSettings(): Promise<ClaudeSettings> {
    const settingsPath = `${this.claudeHome}/settings.json`;
    const file = Bun.file(settingsPath);

    if (await file.exists()) {
      return (await file.json()) as ClaudeSettings;
    }
    return {};
  }

  private async saveSettings(settings: ClaudeSettings): Promise<void> {
    const settingsPath = `${this.claudeHome}/settings.json`;
    await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
  }

  private registerAllHooks(
    settings: ClaudeSettings,
    hooksByEvent: Map<HookEvent, DiscoveredHook[]>,
  ): void {
    const hooks = settings.hooks ?? {};
    settings.hooks = hooks;

    for (const [shakaEvent, discoveredHooks] of hooksByEvent) {
      const claudeEvent = SHAKA_TO_CLAUDE_EVENT[shakaEvent];

      if (!Array.isArray(hooks[claudeEvent])) {
        hooks[claudeEvent] = [];
      }

      const eventHooks = hooks[claudeEvent] as ClaudeHookEntry[];
      const hooksWithMatchers = discoveredHooks.filter((h) => h.matchers && h.matchers.length > 0);
      const hooksWithoutMatchers = discoveredHooks.filter(
        (h) => !h.matchers || h.matchers.length === 0,
      );

      registerHooksWithMatchers(eventHooks, hooksWithMatchers);
      registerHooksWithoutMatchers(eventHooks, hooksWithoutMatchers);
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
