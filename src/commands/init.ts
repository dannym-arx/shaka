/**
 * CLI handler for `shaka init` command.
 *
 * Sets up shaka from current state. Idempotent — safe to run anytime.
 * For safe upgrades with version checking, use `shaka update`.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { findNewerLocalTag, getGitRef } from "../domain/version";
import { createProvider } from "../providers/registry";
import type { ProviderName } from "../providers/types";
import { type InitResult, InitService } from "../services/init-service";

function logProviderStatus(providers: InitResult["providers"]): void {
  console.log("Detecting providers...");
  console.log(`  Claude Code: ${providers.claude.detected ? "✓ detected" : "✗ not found"}`);
  console.log(`  opencode:    ${providers.opencode.detected ? "✓ detected" : "✗ not found"}`);
}

async function installProviderHooks(
  providers: InitResult["providers"],
  shakaHome: string,
): Promise<void> {
  const providerNames: ProviderName[] = ["claude", "opencode"];
  for (const providerName of providerNames) {
    if (providers[providerName].installed) {
      const provider = createProvider(providerName);
      const hookResult = await provider.installHooks({ shakaHome });
      if (!hookResult.ok) {
        console.error(`  ✗ Failed to install ${providerName} hooks: ${hookResult.error.message}`);
      } else {
        console.log(`  ✓ Installed ${providerName} hooks`);
      }
    }
  }
}

function logCreatedItems(result: InitResult): void {
  if (result.symlinks.length > 0) {
    console.log("\nLinked:");
    for (const link of result.symlinks) {
      console.log(`  ${link}`);
    }
  }
  if (result.files.length > 0) {
    console.log("\nCreated files:");
    for (const file of result.files) {
      console.log(`  ${file}`);
    }
  }
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize Shaka configuration")
    .option("--provider <provider>", "Only set up specific provider (claude or opencode)")
    .option("--force", "Overwrite existing configuration")
    .action(async (options) => {
      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });

      const initService = new InitService({ shakaHome });

      console.log("Initializing Shaka...\n");

      const result = await initService.init({
        provider: options.provider,
        force: options.force,
      });

      if (!result.ok) {
        console.error(`ERROR: ${result.error.message}`);
        process.exit(1);
      }

      const { providers } = result.value;

      logProviderStatus(providers);
      await installProviderHooks(providers, shakaHome);
      logCreatedItems(result.value);

      // Show what we're running on: tag or commit
      const repoRoot = new URL("../..", import.meta.url).pathname;
      const ref = await getGitRef(repoRoot);
      const refLabel = ref
        ? ref.type === "tag"
          ? ref.label
          : `v${result.value.currentVersion} (${ref.label})`
        : `v${result.value.currentVersion}`;

      console.log(`\n✅ Shaka initialized successfully — running on ${refLabel}`);

      // Lightweight local check — no network call
      const newerTag = await findNewerLocalTag(repoRoot);
      if (newerTag) {
        console.log(`   Update available: ${newerTag}. Run \`shaka update\` to upgrade.`);
      }
    });
}
