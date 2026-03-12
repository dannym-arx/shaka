/**
 * Skill source provider setup and re-exports.
 *
 * Call registerDefaultProviders() from the CLI entry point before
 * using detectProvider/getProviderByName. Tests should call
 * clearProviders() before registering test-specific providers.
 */

import { createClawhubProvider } from "./clawhub";
import { createGitHubProvider } from "./github";
import { getAllSourceProviders, registerProvider } from "./registry";

let defaultsRegistered = false;

/**
 * Register the built-in providers in priority order.
 * Idempotent — safe to call multiple times.
 */
export function registerDefaultProviders(): void {
  const providers = getAllSourceProviders();
  if (defaultsRegistered && providers.length > 0) return;

  // GitHub first (matches `/`, `https://`, `git@`), Clawhub catches bare words.
  if (!providers.some((provider) => provider.name === "github")) {
    registerProvider(createGitHubProvider());
  }
  if (!providers.some((provider) => provider.name === "clawhub")) {
    registerProvider(createClawhubProvider());
  }

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
export { createClawhubProvider, createClawdhubProvider } from "./clawhub";
export type {
  ClawhubProviderOptions,
  ClawhubFetchFn,
  ClawdhubProviderOptions,
  ClawdhubFetchFn,
} from "./clawhub";
