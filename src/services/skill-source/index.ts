/**
 * Skill source provider setup and re-exports.
 *
 * Call registerDefaultProviders() from the CLI entry point before
 * using detectProvider/getProviderByName. Tests should call
 * clearProviders() before registering test-specific providers.
 */

import { createClawdhubProvider } from "./clawdhub";
import { createGitHubProvider } from "./github";
import { registerProvider } from "./registry";

let defaultsRegistered = false;

/**
 * Register the built-in providers in priority order.
 * Idempotent — safe to call multiple times.
 */
export function registerDefaultProviders(): void {
  if (defaultsRegistered) return;
  // GitHub first (matches `/`, `https://`, `git@`), Clawdhub catches bare words.
  registerProvider(createGitHubProvider());
  registerProvider(createClawdhubProvider());
  defaultsRegistered = true;
}

export {
  detectProvider,
  getProviderByName,
  getAllSourceProviders,
  clearProviders,
} from "./registry";
export type { SkillSourceProvider, FetchResult, FetchOptions } from "./types";
export { createGitHubProvider } from "./github";
export type { GitHubProviderOptions, GitCloneFn, GitRevParseFn } from "./github";
export { createClawdhubProvider } from "./clawdhub";
export type { ClawdhubProviderOptions, ClawdhubFetchFn } from "./clawdhub";
