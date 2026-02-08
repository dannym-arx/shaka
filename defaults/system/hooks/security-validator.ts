#!/usr/bin/env bun
/**
 * Security Validator Hook - PreToolUse validation
 *
 * Validates Bash commands and file operations against security patterns.
 * Prevents catastrophic operations, confirms dangerous ones.
 *
 * TRIGGER: tool.before (PreToolUse in Claude Code)
 * MATCHER: Bash, Edit, Write, Read
 *
 * Output:
 * - {"continue": true} → Allow operation
 * - {"decision": "ask", "message": "..."} → Prompt user
 * - exit(2) → Hard block (catastrophic)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type PatternsConfig,
  type ValidationResult,
  emptyPatternsConfig,
  resolveShakaHome,
  validateBashCommand,
  validatePath,
} from "shaka";
import { parse as parseYaml } from "yaml";

/** Hook trigger events */
export const TRIGGER = ["tool.before"] as const;

/** Tool matchers - which tools this hook validates */
export const MATCHER = ["Bash", "Edit", "Write", "Read"] as const;

export const HOOK_VERSION = "0.2.0";

// Types
interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown> | string;
}

interface SecurityEvent {
  timestamp: string;
  session_id: string;
  event_type: "block" | "confirm" | "alert" | "allow";
  tool: string;
  target: string;
  reason?: string;
}

// Config loading with caching
let patternsCache: PatternsConfig | null = null;

function loadPatterns(shakaHome: string): PatternsConfig {
  if (patternsCache) return patternsCache;

  // Try customizations first, then system
  const customPath = `${shakaHome}/customizations/security/patterns.yaml`;
  const systemPath = `${shakaHome}/system/security/patterns.yaml`;

  const patternsPath = existsSync(customPath)
    ? customPath
    : existsSync(systemPath)
      ? systemPath
      : null;

  if (!patternsPath) {
    return emptyPatternsConfig();
  }

  try {
    const content = readFileSync(patternsPath, "utf-8");
    patternsCache = parseYaml(content) as PatternsConfig;
    return patternsCache;
  } catch {
    return emptyPatternsConfig();
  }
}

// Logging
function logSecurityEvent(shakaHome: string, event: SecurityEvent): void {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    const logDir = `${shakaHome}/memory/security/${year}/${month}`;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const logPath = `${logDir}/security-${event.event_type}-${timestamp}.json`;

    writeFileSync(logPath, JSON.stringify(event, null, 2));
  } catch {
    // Logging failure should not block operations
  }
}

// Tool handlers
function handleBash(input: HookInput, shakaHome: string, patterns: PatternsConfig): void {
  const command =
    typeof input.tool_input === "string"
      ? input.tool_input
      : ((input.tool_input?.command as string) ?? "");

  if (!command) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const result = validateBashCommand(command, patterns);
  handleValidationResult(input, "Bash", command, result, shakaHome);
}

function handleFileOperation(
  input: HookInput,
  tool: string,
  operation: "read" | "write",
  shakaHome: string,
  patterns: PatternsConfig,
): void {
  const filePath =
    typeof input.tool_input === "string"
      ? input.tool_input
      : ((input.tool_input?.file_path as string) ?? "");

  if (!filePath) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const result = validatePath(filePath, operation, patterns);
  handleValidationResult(input, tool, filePath, result, shakaHome);
}

function handleValidationResult(
  input: HookInput,
  tool: string,
  target: string,
  result: ValidationResult,
  shakaHome: string,
): void {
  const event: SecurityEvent = {
    timestamp: new Date().toISOString(),
    session_id: input.session_id,
    event_type: result.action,
    tool,
    target: target.slice(0, 500),
    reason: result.reason,
  };

  switch (result.action) {
    case "block":
      logSecurityEvent(shakaHome, event);
      console.error(`[SHAKA SECURITY] BLOCKED: ${result.reason}`);
      console.error(`Target: ${target.slice(0, 100)}`);
      process.exit(2);
      break; // unreachable, but satisfies linter

    case "confirm":
      logSecurityEvent(shakaHome, event);
      console.log(
        JSON.stringify({
          decision: "ask",
          message: `[SHAKA SECURITY] ${result.reason}\n\nTarget: ${target.slice(0, 200)}\n\nProceed?`,
        }),
      );
      break;

    case "alert":
      logSecurityEvent(shakaHome, event);
      console.error(`[SHAKA SECURITY] Alert: ${result.reason}`);
      console.log(JSON.stringify({ continue: true }));
      break;

    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

// Main
async function main(): Promise<void> {
  let input: HookInput;

  try {
    const text = await Promise.race([
      Bun.stdin.text(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
    ]);

    if (!text.trim()) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    input = JSON.parse(text);
  } catch {
    // Parse error or timeout - fail open
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const shakaHome = resolveShakaHome();
  const patterns = loadPatterns(shakaHome);

  switch (input.tool_name) {
    case "Bash":
      handleBash(input, shakaHome, patterns);
      break;
    case "Edit":
    case "MultiEdit":
    case "Write":
      handleFileOperation(input, input.tool_name, "write", shakaHome, patterns);
      break;
    case "Read":
      handleFileOperation(input, "Read", "read", shakaHome, patterns);
      break;
    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

if (import.meta.main) {
  main().catch(() => {
    // Fail open on any error
    console.log(JSON.stringify({ continue: true }));
  });
}
