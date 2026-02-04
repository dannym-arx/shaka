/**
 * opencode provider configuration.
 * Creates in-process plugin in .opencode/plugins/.
 *
 * Hooks are discovered from ${shakaHome}/system/hooks/*.ts
 * The generated plugin calls hooks via subprocess to maintain compatibility.
 */

import { mkdir, unlink } from "node:fs/promises";
import { type Result, err, ok } from "../../domain/result";
import { type DiscoveredHook, discoverHooks } from "../hook-discovery";
import type { HookConfig, HookVerificationResult, ProviderConfigurer } from "../types";

export class OpencodeProviderConfigurer implements ProviderConfigurer {
  readonly name = "opencode" as const;
  private readonly projectRoot: string;

  constructor(options?: { projectRoot?: string }) {
    this.projectRoot = options?.projectRoot ?? process.cwd();
  }

  async isInstalled(): Promise<boolean> {
    const proc = Bun.spawn(["which", "opencode"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return (await proc.exited) === 0;
  }

  async installHooks(config: HookConfig): Promise<Result<void, Error>> {
    try {
      const pluginsDir = `${this.projectRoot}/.opencode/plugins`;
      await mkdir(pluginsDir, { recursive: true });

      // Discover hooks
      const hooksDir = `${config.shakaHome}/system/hooks`;
      const hooks = await discoverHooks(hooksDir);

      // Generate plugin
      const pluginPath = `${pluginsDir}/shaka.ts`;
      const pluginContent = this.generatePluginContent(config, hooks);
      await Bun.write(pluginPath, pluginContent);

      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async uninstallHooks(): Promise<Result<void, Error>> {
    try {
      const pluginPath = `${this.projectRoot}/.opencode/plugins/shaka.ts`;
      const file = Bun.file(pluginPath);

      if (await file.exists()) {
        await unlink(pluginPath);
      }

      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async verifyHooks(): Promise<HookVerificationResult> {
    const issues: string[] = [];

    const pluginPath = `${this.projectRoot}/.opencode/plugins/shaka.ts`;
    const file = Bun.file(pluginPath);

    if (!(await file.exists())) {
      issues.push("shaka.ts plugin not found");
    }

    return {
      installed: issues.length === 0,
      issues,
    };
  }

  private generatePluginContent(config: HookConfig, hooks: DiscoveredHook[]): string {
    // Group hooks by Shaka canonical event names
    const sessionStartHooks = hooks.filter((h) => h.event === "session.start");
    const userPromptHooks = hooks.filter((h) => h.event === "prompt.submit");
    const preToolHooks = hooks.filter((h) => h.event === "tool.before");

    return `/**
 * Shaka plugin for opencode.
 * Auto-generated - do not edit manually.
 *
 * Discovered hooks:
${hooks.map((h) => ` *   - ${h.filename} (${h.event})`).join("\n")}
 */

const SHAKA_HOME = "${config.shakaHome}";

interface HookOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

/**
 * Run a hook script and capture its JSON output.
 */
async function runHook(hookPath: string, input: unknown = {}): Promise<HookOutput | null> {
  try {
    const proc = Bun.spawn(["bun", hookPath], {
      stdin: new Blob([JSON.stringify(input)]),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.error(\`[shaka] Hook \${hookPath} failed with exit code \${exitCode}\`);
      return null;
    }

    // Find JSON in output (hooks may log to stderr, JSON goes to stdout)
    const jsonMatch = stdout.match(/\\{[\\s\\S]*\\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as HookOutput;
  } catch (error) {
    console.error(\`[shaka] Error running hook \${hookPath}:\`, error);
    return null;
  }
}

// Session start context (loaded once at plugin init)
let sessionContext: string | null = null;

// Initialize session context
${
  sessionStartHooks.length > 0
    ? `
(async () => {
  const hooks = ${JSON.stringify(sessionStartHooks.map((h) => h.path))};
  const parts: string[] = [];

  for (const hookPath of hooks) {
    const result = await runHook(hookPath);
    if (result?.hookSpecificOutput?.additionalContext) {
      parts.push(result.hookSpecificOutput.additionalContext);
    }
  }

  sessionContext = parts.join("\\n\\n");
  if (sessionContext) {
    console.error("[shaka] Session context loaded");
  }
})();
`
    : "// No SessionStart hooks discovered"
}

export default {
  name: "shaka",

${
  userPromptHooks.length > 0 || sessionStartHooks.length > 0
    ? `
  // Context injection
  "experimental.chat.system.transform": async (
    input: { system: string },
    output: { system: string[] }
  ) => {
    // Add session context if available
    if (sessionContext) {
      output.system.push(sessionContext);
    }

    ${
      userPromptHooks.length > 0
        ? `
    // Run UserPromptSubmit hooks
    const hooks = ${JSON.stringify(userPromptHooks.map((h) => h.path))};
    for (const hookPath of hooks) {
      const result = await runHook(hookPath, input);
      if (result?.hookSpecificOutput?.additionalContext) {
        output.system.push(result.hookSpecificOutput.additionalContext);
      }
    }
    `
        : ""
    }
  },
`
    : ""
}

${
  preToolHooks.length > 0
    ? `
  // Tool execution hooks
  "tool.execute.before": async (
    input: { tool: string; args: Record<string, unknown> },
    output: { abort?: boolean; error?: string }
  ) => {
    const hooks = ${JSON.stringify(preToolHooks.map((h) => h.path))};
    for (const hookPath of hooks) {
      const result = await runHook(hookPath, input);
      // PreToolUse hooks can abort execution
      if (result?.hookSpecificOutput && "abort" in result.hookSpecificOutput) {
        output.abort = true;
        output.error = result.hookSpecificOutput.error || "Hook aborted execution";
        break;
      }
    }
  },
`
    : ""
}
};
`;
  }
}
