/**
 * Skill source provider registry.
 *
 * Providers are registered in priority order. Detection iterates
 * them and returns the first that canHandle() the input.
 *
 * Registration order matters:
 *   1. GitHub (matches inputs with `/`, `https://`, `git@`)
 *   2. Clawdhub (catches bare words like `sonoscli`, `sonoscli@1.2.0`)
 */

import { type Result, err, ok } from "../../domain/result";
import type { SkillSourceProvider } from "./types";

const providers: SkillSourceProvider[] = [];

/** Register a skill source provider. Order determines detection priority. */
export function registerProvider(provider: SkillSourceProvider): void {
  providers.push(provider);
}

/**
 * Detect the appropriate provider for the given input.
 * Returns the first provider whose canHandle() returns true.
 */
export function detectProvider(input: string): Result<SkillSourceProvider, Error> {
  for (const provider of providers) {
    if (provider.canHandle(input)) {
      return ok(provider);
    }
  }
  return err(new Error(`No skill source provider found for: ${input}`));
}

/** Look up a provider by name (used for updates from manifest). */
export function getProviderByName(name: string): Result<SkillSourceProvider, Error> {
  const provider = providers.find((p) => p.name === name);
  if (!provider) {
    return err(new Error(`Unknown skill source provider: ${name}`));
  }
  return ok(provider);
}

/** List all registered providers. */
export function getAllSourceProviders(): readonly SkillSourceProvider[] {
  return providers;
}

/** Clear all registered providers (for testing). */
export function clearProviders(): void {
  providers.length = 0;
}
