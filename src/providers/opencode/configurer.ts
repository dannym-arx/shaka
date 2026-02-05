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
 * Normalize opencode tool names/args to Claude Code format.
 * opencode uses lowercase tool names and camelCase args;
 * Claude Code hooks expect PascalCase names and snake_case args.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
};

const ARGS_KEY_MAP: Record<string, Record<string, string>> = {
  read: { filePath: "file_path" },
  write: { filePath: "file_path", content: "content" },
  edit: { filePath: "file_path" },
  bash: { command: "command" },
};

function normalizeToolName(opencodeName: string): string {
  return TOOL_NAME_MAP[opencodeName] || opencodeName;
}

function normalizeArgs(opencodeTool: string, args: Record<string, unknown>): Record<string, unknown> {
  const keyMap = ARGS_KEY_MAP[opencodeTool];
  if (!keyMap) return args;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    normalized[keyMap[key] || key] = value;
  }
  return normalized;
}

/**
 * Run a hook script and capture its output.
 * Returns { exitCode, output } for proper handling.
 */
async function runHookRaw(hookPath: string, input: unknown = {}): Promise<{ exitCode: number; output: ClaudeHookOutput | null; rawOutput: string }> {
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

    // Try to parse as JSON; hooks may output plain text instead
    let output: ClaudeHookOutput | null = null;
    try {
      output = JSON.parse(stdout.trim()) as ClaudeHookOutput;
    } catch {
      // Not JSON — plain text output, available via rawOutput
    }

    return { exitCode, output, rawOutput: stdout.trim() };
  } catch (error) {
    console.error(\`[shaka] Error running hook \${hookPath}:\`, error);
    return { exitCode: 1, output: null, rawOutput: "" };
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

/**
 * Shaka plugin entry point.
 * opencode calls this function once at load time;
 * it must return a Hooks object.
 */
export const ShakaPlugin = async (ctx: { directory: string; [key: string]: unknown }) => {
  // Session start context (loaded once at plugin init)
  let sessionContext: string | null = null;
  const sessionId = \`opencode-\${Date.now()}\`;

${
  sessionStartHooks.length > 0
    ? `
  // Load session context from SessionStart hooks
  const sessionHooks = ${JSON.stringify(sessionStartHooks.map((h) => h.path))};
  const contextParts: string[] = [];

  for (const hookPath of sessionHooks) {
    const { output, rawOutput } = await runHookRaw(hookPath);
    if (output?.hookSpecificOutput?.additionalContext) {
      contextParts.push(output.hookSpecificOutput.additionalContext);
    } else if (rawOutput) {
      contextParts.push(rawOutput);
    }
  }

  sessionContext = contextParts.join("\\n\\n");
  if (sessionContext) {
    console.error("[shaka] Session context loaded");
  }
`
    : "  // No SessionStart hooks discovered"
}

  return {
${
  userPromptHooks.length > 0 || sessionStartHooks.length > 0
    ? `
    // Context injection
    "experimental.chat.system.transform": async (
      input: { sessionID?: string; [key: string]: unknown },
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
        const { output: hookOutput, rawOutput } = await runHookRaw(hookPath, input);
        if (hookOutput?.hookSpecificOutput?.additionalContext) {
          output.system.push(hookOutput.hookSpecificOutput.additionalContext);
        } else if (rawOutput) {
          output.system.push(rawOutput);
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
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => {
      const claudeToolName = normalizeToolName(input.tool);
      const claudeArgs = normalizeArgs(input.tool, output.args);

      // Normalize opencode format → Claude Code format
      const claudeInput: ClaudeHookInput = {
        session_id: input.sessionID || sessionId,
        tool_name: claudeToolName,
        tool_input: claudeArgs,
      };

      for (const hook of TOOL_HOOKS) {
        // Filter by matcher (using normalized Claude Code tool name)
        if (!shouldRunForTool(hook, claudeToolName)) continue;

        const { exitCode, output: hookOutput } = await runHookRaw(hook.path, claudeInput);

        // Handle Claude Code output format → opencode format
        // exit(2) = hard block — throw to abort tool execution
        if (exitCode === 2) {
          throw new Error("[SHAKA SECURITY] Operation blocked by security policy");
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
};
`;
  }
}
