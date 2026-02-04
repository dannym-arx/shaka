/**
 * Hook discovery utilities.
 * Shared between Claude and opencode configurers.
 *
 * Hooks declare their trigger events by exporting a TRIGGER constant:
 *   export const TRIGGER = ["session.start"] as const;
 *   export const TRIGGER = ["session.start", "prompt.submit"] as const;
 *
 * Event names are Shaka's canonical names (provider-agnostic).
 * Provider configurers map these to provider-specific event names.
 */

import { readdir } from "node:fs/promises";

/**
 * Shaka's canonical hook event names.
 * These are provider-agnostic — conversion happens in provider configurers.
 */
export const HOOK_EVENTS = ["session.start", "prompt.submit", "tool.before", "tool.after"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface DiscoveredHook {
  /** Filename (e.g., "session-start.ts") */
  filename: string;
  /** Event name from exported TRIGGER constant */
  event: HookEvent;
  /** Full path to the hook file */
  path: string;
}

/**
 * Parse a hook file to extract its trigger events.
 * Imports the file and reads the exported TRIGGER array.
 */
export async function parseHookTrigger(filePath: string): Promise<HookEvent[]> {
  try {
    // Add cache-busting to ensure fresh import (important for tests and hot-reload)
    const module = await import(`${filePath}?t=${Date.now()}`);
    const trigger = module.TRIGGER;

    if (!Array.isArray(trigger)) {
      return [];
    }

    return trigger.filter(
      (t): t is HookEvent => typeof t === "string" && HOOK_EVENTS.includes(t as HookEvent),
    );
  } catch {
    return [];
  }
}

/**
 * Discover all hooks in a directory.
 * Returns hooks that have a valid TRIGGER export.
 * Hooks with multiple triggers create multiple entries.
 */
export async function discoverHooks(hooksDir: string): Promise<DiscoveredHook[]> {
  const hooks: DiscoveredHook[] = [];

  try {
    const entries = await readdir(hooksDir);

    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;

      const filePath = `${hooksDir}/${entry}`;
      const events = await parseHookTrigger(filePath);

      for (const event of events) {
        hooks.push({
          filename: entry,
          event,
          path: filePath,
        });
      }
    }
  } catch {
    // Directory doesn't exist yet - that's ok during init
  }

  return hooks;
}

/**
 * Map Shaka event names to Claude Code event names.
 * Used by Claude configurer when writing to settings.json.
 */
export const SHAKA_TO_CLAUDE_EVENT: Record<HookEvent, string> = {
  "session.start": "SessionStart",
  "prompt.submit": "UserPromptSubmit",
  "tool.before": "PreToolUse",
  "tool.after": "PostToolUse",
};

/**
 * Map Shaka event names to opencode plugin hooks.
 * Used by opencode configurer when generating the plugin.
 * null means no direct equivalent — handled specially.
 */
export const SHAKA_TO_OPENCODE_HOOK: Record<HookEvent, string | null> = {
  "session.start": null, // No direct equivalent - handled at plugin load
  "prompt.submit": "experimental.chat.system.transform",
  "tool.before": "tool.execute.before",
  "tool.after": "tool.execute.after",
};
