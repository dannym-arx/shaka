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

      // Validate generated plugin compiles
      const validationResult = await this.validatePluginSyntax(pluginPath);
      if (!validationResult.ok) {
        await unlink(pluginPath);
        return validationResult;
      }

      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async validatePluginSyntax(pluginPath: string): Promise<Result<void, Error>> {
    const result = await Bun.build({
      entrypoints: [pluginPath],
      throw: false,
    });

    if (!result.success) {
      const errors = result.logs
        .filter((log) => log.level === "error")
        .map((log) => log.message)
        .join("\n");
      return err(new Error(`Generated plugin has syntax errors:\n${errors}`));
    }

    return ok(undefined);
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

    // Build matcher map for tool hooks: { hookPath: matchers[] | null }
    const toolHookMatchers = preToolHooks.map((h) => ({
      path: h.path,
      matchers: h.matchers ?? null,
    }));

    return `/**
 * Shaka plugin for opencode.
 * Auto-generated - do not edit manually.
 *
 * Discovered hooks:
${hooks.map((h) => ` *   - ${h.filename} (${h.event}${h.matchers ? `, matchers: ${h.matchers.join(", ")}` : ""})`).join("\n")}
 */

const SHAKA_HOME = "${config.shakaHome}";

interface ClaudeHookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ClaudeHookOutput {
  continue?: boolean;
  decision?: "ask";
  message?: string;
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

interface ToolHookConfig {
  path: string;
  matchers: string[] | null;
}

const TOOL_HOOKS: ToolHookConfig[] = ${JSON.stringify(toolHookMatchers, null, 2)};

/**
 * Run a hook script and capture its output.
 * Returns { exitCode, output } for proper handling.
 */
async function runHookRaw(hookPath: string, input: unknown = {}): Promise<{ exitCode: number; output: ClaudeHookOutput | null }> {
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

    // Find JSON in output (hooks may log to stderr, JSON goes to stdout)
    const jsonMatch = stdout.match(/\\{[\\s\\S]*\\}/);
    const output = jsonMatch ? JSON.parse(jsonMatch[0]) as ClaudeHookOutput : null;

    return { exitCode, output };
  } catch (error) {
    console.error(\`[shaka] Error running hook \${hookPath}:\`, error);
    return { exitCode: 1, output: null };
  }
}

/**
 * Check if a hook should run for a given tool.
 * Hooks without matchers run for all tools.
 * Hooks with matchers only run for matching tools.
 */
function shouldRunForTool(hook: ToolHookConfig, toolName: string): boolean {
  if (!hook.matchers) return true;
  return hook.matchers.includes(toolName);
}

// Session start context (loaded once at plugin init)
let sessionContext: string | null = null;
let sessionId = \`opencode-\${Date.now()}\`;

// Initialize session context
${
  sessionStartHooks.length > 0
    ? `
(async () => {
  const hooks = ${JSON.stringify(sessionStartHooks.map((h) => h.path))};
  const parts: string[] = [];

  for (const hookPath of hooks) {
    const { output } = await runHookRaw(hookPath);
    if (output?.hookSpecificOutput?.additionalContext) {
      parts.push(output.hookSpecificOutput.additionalContext);
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
      const { output: hookOutput } = await runHookRaw(hookPath, input);
      if (hookOutput?.hookSpecificOutput?.additionalContext) {
        output.system.push(hookOutput.hookSpecificOutput.additionalContext);
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
  // Tool execution hooks with matcher filtering and format normalization
  "tool.execute.before": async (
    input: { tool: string; args: Record<string, unknown> },
    output: { abort?: boolean; error?: string }
  ) => {
    // Normalize opencode format → Claude Code format
    const claudeInput: ClaudeHookInput = {
      session_id: sessionId,
      tool_name: input.tool,
      tool_input: input.args,
    };

    for (const hook of TOOL_HOOKS) {
      // Filter by matcher
      if (!shouldRunForTool(hook, input.tool)) continue;

      const { exitCode, output: hookOutput } = await runHookRaw(hook.path, claudeInput);

      // Handle Claude Code output format → opencode format
      // exit(2) = hard block
      if (exitCode === 2) {
        output.abort = true;
        output.error = "[SHAKA SECURITY] Operation blocked by security policy";
        return;
      }

      // { decision: "ask" } = confirm (log warning, let opencode's permission system handle)
      if (hookOutput?.decision === "ask") {
        console.error(\`[SHAKA SECURITY] Warning: \${hookOutput.message || "Operation flagged for review"}\`);
        // Don't abort - let opencode's native permission system prompt if configured
      }

      // { continue: true } = allow, keep going
      // null/error = fail open, keep going
    }
  },
`
    : ""
}
};
`;
  }
}
