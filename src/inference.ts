/**
 * Provider-agnostic inference tool
 * @version 1.2.0
 *
 * Uses CLI tools that handle their own authentication:
 * 1. Claude CLI (claude -p) — if installed
 * 2. OpenCode CLI (opencode run) — if installed, handles local models too
 *
 * No API keys needed — CLIs manage auth. Install one and inference works.
 */

import { spawn } from "node:child_process";
import { detectInstalledProviders } from "./services/provider-detection";

export interface InferenceOptions {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  timeout?: number;
  expectJson?: boolean;
}

export interface InferenceResult {
  success: boolean;
  text?: string;
  parsed?: unknown;
  error?: string;
  provider?: string;
}

// ---------------------------------------------------------------------------
// CLI-Based Inference
// ---------------------------------------------------------------------------

/**
 * Call Claude CLI for inference.
 *
 * Uses spawn (not Bun.$) because Bun.$ drops empty string arguments.
 * --setting-sources "" disables hooks (prevents recursion).
 * --tools "" disables tool use (pure text inference).
 * Prompt is piped via stdin to avoid argument length limits.
 */
async function callClaudeCLI(options: InferenceOptions): Promise<InferenceResult> {
  const args = ["--setting-sources", "", "--tools", ""];
  if (options.model) args.push("--model", options.model);
  if (options.systemPrompt) args.push("--system-prompt", options.systemPrompt);
  args.push("-p");

  const result = await spawnCLI("claude", args, options.userPrompt, options.timeout);

  if (result.code !== 0) {
    return {
      success: false,
      error: `Claude CLI error: ${result.stderr}`,
      provider: "claude-cli",
    };
  }

  return parseResponse(result.stdout.trim(), options.expectJson, "claude-cli");
}

async function callOpenCodeCLI(options: InferenceOptions): Promise<InferenceResult> {
  const prompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${options.userPrompt}`
    : options.userPrompt;

  const args = ["run", prompt];
  // opencode expects provider/model format (e.g., "anthropic/claude-haiku-4-5")
  // Skip bare aliases like "haiku" which are Claude CLI-specific
  if (options.model?.includes("/")) args.push("--model", options.model);
  const result = await Bun.$`opencode ${args}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `OpenCode CLI error: ${result.stderr.toString()}`,
      provider: "opencode-cli",
    };
  }

  const text = result.stdout.toString().trim();
  return parseResponse(text, options.expectJson, "opencode-cli");
}

// ---------------------------------------------------------------------------
// Process Management
// ---------------------------------------------------------------------------

function spawnCLI(
  command: string,
  args: string[],
  stdin: string,
  timeout?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    if (timeout) {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill("SIGTERM");
          resolve({ code: 1, stdout, stderr: `Timeout after ${timeout}ms` });
        }
      }, timeout);
    }

    proc.stdin.write(stdin);
    proc.stdin.end();
    proc.stdout.on("data", (d) => {
      stdout += d;
    });
    proc.stderr.on("data", (d) => {
      stderr += d;
    });
    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        resolve({ code: 1, stdout: "", stderr: err.message });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseResponse(text: string, expectJson?: boolean, provider?: string): InferenceResult {
  if (!expectJson) {
    return { success: true, text, provider };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { success: true, text, parsed, provider };
    } catch {
      return { success: true, text, provider };
    }
  }

  return { success: true, text, provider };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Run inference using available CLI tools.
 *
 * Tries Claude CLI first, then OpenCode CLI.
 * Both handle their own authentication — no API keys needed.
 */
export async function inference(options: InferenceOptions): Promise<InferenceResult> {
  const providers = await detectInstalledProviders();

  if (providers.claude) {
    const result = await callClaudeCLI(options);
    if (result.success) return result;
  }

  if (providers.opencode) {
    const result = await callOpenCodeCLI(options);
    if (result.success) return result;
  }

  return {
    success: false,
    error: "No inference provider available. Install claude or opencode CLI.",
  };
}

/**
 * Check if any inference CLI is available.
 */
export async function hasInferenceProvider(): Promise<boolean> {
  const providers = await detectInstalledProviders();
  return providers.claude || providers.opencode;
}
