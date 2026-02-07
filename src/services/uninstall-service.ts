/**
 * Uninstall service for `shaka uninstall` command.
 *
 * Reverses what `shaka init` does:
 * - Removes provider hooks (Claude settings.json entries, opencode plugin)
 * - Removes system/ symlink
 * - Removes .shaka-version and config.json
 * - Optionally removes user-owned directories (user/, customizations/, memory/)
 */

import { lstat, readdir, rm } from "node:fs/promises";
import { type Result, ok } from "../domain/result";
import type { ClaudeProviderConfigurer } from "../providers/claude/configurer";
import { createProvider } from "../providers/registry";
import type { ProviderName } from "../providers/types";
import { type DetectedProviders, detectInstalledProviders } from "./provider-detection";

export interface UninstallServiceConfig {
  shakaHome: string;
  /** Override provider detection (for testing) */
  detectProviders?: () => Promise<DetectedProviders>;
}

export interface UninstallOptions {
  /** Delete user-owned directories (user/, customizations/, memory/) */
  deleteUserData: boolean;
}

export interface UninstallResult {
  providers: {
    claude: { detected: boolean; uninstalled: boolean };
    opencode: { detected: boolean; uninstalled: boolean };
  };
  removed: string[];
  errors: string[];
}

export class UninstallService {
  private readonly shakaHome: string;
  private readonly detectProviders: () => Promise<DetectedProviders>;

  constructor(config: UninstallServiceConfig) {
    this.shakaHome = config.shakaHome;
    this.detectProviders = config.detectProviders ?? detectInstalledProviders;
  }

  /**
   * Uninstall provider hooks via each provider's uninstallHooks().
   */
  async uninstallProviderHooks(): Promise<UninstallResult["providers"]> {
    const detected = await this.detectProviders();
    const providerNames: ProviderName[] = ["claude", "opencode"];
    const result: UninstallResult["providers"] = {
      claude: { detected: detected.claude, uninstalled: false },
      opencode: { detected: detected.opencode, uninstalled: false },
    };

    for (const name of providerNames) {
      if (!detected[name]) continue;
      const provider = createProvider(name);
      const hookResult = await provider.uninstallHooks();
      result[name].uninstalled = hookResult.ok;
    }

    // Unregister MCP server from Claude Code
    if (detected.claude) {
      const claude = createProvider("claude") as ClaudeProviderConfigurer;
      await claude.unregisterMcpServer();
    }

    return result;
  }

  /**
   * Remove system/ symlink (only if it's a symlink, never delete a real directory).
   */
  async removeSystemLink(): Promise<Result<boolean, Error>> {
    const linkPath = `${this.shakaHome}/system`;

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        await rm(linkPath);
        return ok(true);
      }
      // Real directory — don't touch it
      return ok(false);
    } catch {
      // Doesn't exist — nothing to remove
      return ok(false);
    }
  }

  /**
   * Remove framework-owned files (.shaka-version, config.json).
   */
  async removeFrameworkFiles(): Promise<string[]> {
    const removed: string[] = [];
    const files = [`${this.shakaHome}/.shaka-version`, `${this.shakaHome}/config.json`];

    for (const filePath of files) {
      try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          await rm(filePath);
          removed.push(filePath);
        }
      } catch {
        // Best-effort — continue on failure
      }
    }

    return removed;
  }

  /**
   * Remove node_modules/ link at shakaHome (created by bun link shaka).
   */
  async removeNodeModulesLink(): Promise<boolean> {
    const nmPath = `${this.shakaHome}/node_modules`;
    try {
      await rm(nmPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove user-owned directories (user/, customizations/, memory/).
   */
  async removeUserData(): Promise<string[]> {
    const removed: string[] = [];
    const dirs = ["user", "customizations", "memory"];

    for (const dir of dirs) {
      const dirPath = `${this.shakaHome}/${dir}`;
      try {
        const stats = await lstat(dirPath);
        if (stats.isDirectory()) {
          await rm(dirPath, { recursive: true });
          removed.push(dirPath);
        }
      } catch {
        // Doesn't exist — skip
      }
    }

    return removed;
  }

  /**
   * Remove shakaHome directory if it's empty.
   */
  async removeShakaHomeIfEmpty(): Promise<boolean> {
    try {
      const entries = await readdir(this.shakaHome);
      if (entries.length === 0) {
        await rm(this.shakaHome, { recursive: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Run full uninstallation.
   */
  async uninstall(options: UninstallOptions): Promise<Result<UninstallResult, Error>> {
    const removed: string[] = [];
    const errors: string[] = [];

    // 1. Uninstall provider hooks
    const providers = await this.uninstallProviderHooks();

    for (const name of ["claude", "opencode"] as const) {
      if (providers[name].detected && !providers[name].uninstalled) {
        errors.push(`Failed to uninstall ${name} hooks`);
      }
    }

    // 2. Remove system/ symlink
    const symlinkResult = await this.removeSystemLink();
    if (symlinkResult.ok && symlinkResult.value) {
      removed.push(`${this.shakaHome}/system`);
    }

    // 3. Remove framework files
    const frameworkFiles = await this.removeFrameworkFiles();
    removed.push(...frameworkFiles);

    // 4. Remove node_modules link
    const nmRemoved = await this.removeNodeModulesLink();
    if (nmRemoved) {
      removed.push(`${this.shakaHome}/node_modules`);
    }

    // 5. Optionally remove user data
    if (options.deleteUserData) {
      const userDirs = await this.removeUserData();
      removed.push(...userDirs);
    }

    // 6. Clean up empty shakaHome
    const homeRemoved = await this.removeShakaHomeIfEmpty();
    if (homeRemoved) {
      removed.push(this.shakaHome);
    }

    return ok({ providers, removed, errors });
  }
}
