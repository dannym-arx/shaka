/**
 * Provider abstraction for Claude Code and opencode.
 * Each provider implements this interface to handle hook installation.
 */

import type { Result } from "../domain/result";

export type ProviderName = "claude" | "opencode";

export interface ProviderConfigurer {
  readonly name: ProviderName;

  /** Check if provider CLI is installed */
  isInstalled(): Promise<boolean>;

  /** Install Shaka hooks for this provider */
  installHooks(config: HookConfig): Promise<Result<void, Error>>;

  /** Uninstall Shaka hooks */
  uninstallHooks(): Promise<Result<void, Error>>;

  /** Verify hooks are correctly installed */
  verifyHooks(): Promise<HookVerificationResult>;
}

export interface HookConfig {
  shakaHome: string;
}

export interface HookVerificationResult {
  installed: boolean;
  issues: string[];
}
