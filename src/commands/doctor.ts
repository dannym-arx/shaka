/**
 * CLI handler for `shaka doctor` command.
 * Checks system health and hook installation status.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { getAllProviders } from "../providers/registry";
import type { HookVerificationResult, ProviderConfigurer } from "../providers/types";

async function checkShakaHome(shakaHome: string): Promise<boolean> {
  console.log(`Shaka home: ${shakaHome}`);

  const configFile = Bun.file(`${shakaHome}/config.json`);
  if (await configFile.exists()) {
    console.log("  ✓ config.json exists");
    return false;
  }
  console.log("  ✗ config.json not found");
  return true;
}

function logProviderStatus(
  provider: ProviderConfigurer,
  installed: boolean,
  hookStatus: HookVerificationResult,
): boolean {
  let hasIssues = false;
  console.log(`\n  ${provider.name}:`);
  console.log(`    CLI installed: ${installed ? "✓ yes" : "✗ no"}`);

  if (installed) {
    console.log(`    Hooks configured: ${hookStatus.installed ? "✓ yes" : "✗ no"}`);
    if (hookStatus.issues.length > 0) {
      hasIssues = true;
      for (const issue of hookStatus.issues) {
        console.log(`      - ${issue}`);
      }
    }
  }
  return hasIssues;
}

function printSummary(hasIssues: boolean): void {
  console.log(`\n${"─".repeat(40)}`);
  if (hasIssues) {
    console.log("⚠️  Some issues found. Run `shaka init` to fix.");
    process.exit(1);
  } else {
    console.log("✅ All systems operational.");
  }
}

export function createDoctorCommand(): Command {
  return new Command("doctor").description("Check Shaka installation health").action(async () => {
    console.log("Shaka Doctor\n");
    console.log("Checking system health...\n");

    const shakaHome = resolveShakaHome({
      SHAKA_HOME: process.env.SHAKA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      HOME: process.env.HOME,
    });

    let hasIssues = await checkShakaHome(shakaHome);

    console.log("\nProvider status:");
    const providers = getAllProviders();

    for (const provider of providers) {
      const installed = await provider.isInstalled();
      const hookStatus = await provider.verifyHooks();
      const providerHasIssues = logProviderStatus(provider, installed, hookStatus);
      hasIssues = hasIssues || providerHasIssues;
    }

    printSummary(hasIssues);
  });
}
