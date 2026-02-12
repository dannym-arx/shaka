/**
 * Skill source provider setup and re-exports.
 *
 * Importing this module registers the default providers in priority order.
 * Tests should call clearProviders() before registering test-specific providers.
 */

import { createClawdhubProvider } from "./clawdhub";
import { createGitHubProvider } from "./github";
import { registerProvider } from "./registry";

// Register default providers in priority order.
// GitHub first (matches `/`, `https://`, `git@`), Clawdhub catches bare words.
registerProvider(createGitHubProvider());
registerProvider(createClawdhubProvider());

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
export type { ClawdhubProviderOptions, ClawdhubFetchFn, ClawdhubResolveFn } from "./clawdhub";
