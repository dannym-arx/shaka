/**
 * CLI handler for `shaka init` command.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
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
        console.error(`\n✗ Failed to install ${providerName} hooks: ${hookResult.error.message}`);
      } else {
        console.log(`\n✓ Installed ${providerName} hooks`);
      }
    }
  }
}

function logCreatedItems(directories: string[], files: string[]): void {
  if (directories.length > 0) {
    console.log("\nCreated directories:");
    for (const dir of directories) {
      console.log(`  ${dir}`);
    }
  }
  if (files.length > 0) {
    console.log("\nCreated files:");
    for (const file of files) {
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

      const { providers, directories, files } = result.value;

      logProviderStatus(providers);
      await installProviderHooks(providers, shakaHome);
      logCreatedItems(directories, files);

      console.log("\n✅ Shaka initialized successfully.");
    });
}
