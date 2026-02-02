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

// CLI
const program = new Command();

program.name("shaka").description("Personal AI assistant framework").version("0.1.0");

program.parse(process.argv);
