#!/usr/bin/env bun
/**
 * Shaka CLI entry point.
 * Composition root - all dependency wiring happens here.
 */

import { Command } from "commander";

// Re-export shared functionality for use by defaults/ templates
export {
  detectInstalledProviders,
  isProviderInstalled,
  clearDetectionCache,
  type DetectedProviders,
  type ProviderName,
} from "./services/provider-detection";

export {
  type ShakaConfig,
  type EnvVars,
  validateConfig,
  resolveShakaHome,
  loadConfig,
  loadShakaFile,
  isSubagent,
  getAssistantName,
  getPrincipalName,
} from "./domain/config";

export {
  type Result,
  type Ok,
  type Err,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  flatMap,
} from "./domain/result";

export {
  type SessionStartEvent,
  type SessionStartEventInput,
  type SessionStartSource,
  type HandlerResult,
  createSessionStartEvent,
  isSessionStartEvent,
} from "./domain/events";

export { type HookEvent, HOOK_EVENTS } from "./providers/hook-discovery";

import { createDoctorCommand } from "./commands/doctor";
// Import commands
import { createInitCommand } from "./commands/init";

// CLI - only run when executed directly, not when imported as library
if (import.meta.main) {
  const program = new Command();

  program.name("shaka").description("Personal AI assistant framework").version("0.1.0");

  program.addCommand(createInitCommand());
  program.addCommand(createDoctorCommand());

  program.parse(process.argv);
}
