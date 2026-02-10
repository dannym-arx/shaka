/**
 * CLI handler for `shaka doctor` command.
 * Checks system health, hook installation status, and config-vs-reality alignment.
 */

import { Command } from "commander";
import { type ShakaConfig, loadConfig, resolveShakaHome } from "../domain/config";
import { getAllProviders } from "../providers/registry";
import type { HookVerificationResult, ProviderConfigurer, ProviderName } from "../providers/types";
import { printOpencodeSummarizationHint } from "./hints";

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
  enabled: boolean,
): boolean {
  let hasIssues = false;
  console.log(`\n  ${provider.name}:`);
  console.log(`    CLI installed: ${installed ? "✓ yes" : "✗ no"}`);
  console.log(`    Enabled:       ${enabled ? "✓ yes" : "– no"}`);

  if (installed && enabled) {
    console.log(`    Hooks configured: ${hookStatus.installed ? "✓ yes" : "✗ no"}`);
    if (hookStatus.issues.length > 0) {
      hasIssues = true;
      for (const issue of hookStatus.issues) {
        console.log(`      - ${issue}`);
      }
    }
  } else if (installed && !enabled) {
    console.log("    Hooks configured: – skipped (not enabled)");
  }
  return hasIssues;
}

interface ProviderMismatch {
  name: ProviderName;
  configEnabled: boolean;
  hooksInstalled: boolean;
}

/**
 * Compare config.json provider flags against actual hook installation.
 * Returns mismatches where config doesn't reflect reality.
 */
async function checkProviderConfigAlignment(
  config: ShakaConfig | null,
): Promise<ProviderMismatch[]> {
  if (!config) return [];

  const mismatches: ProviderMismatch[] = [];
  const providers = getAllProviders();

  for (const provider of providers) {
    const installed = await provider.isInstalled();
    const hookStatus = await provider.verifyHooks();
    const configEnabled = config.providers[provider.name].enabled;
    const hooksInstalled = installed && hookStatus.installed;

    if (configEnabled !== hooksInstalled) {
      mismatches.push({ name: provider.name, configEnabled, hooksInstalled });
    }
  }

  return mismatches;
}

function logConfigAlignment(mismatches: ProviderMismatch[]): boolean {
  console.log("\nConfig alignment:");

  if (mismatches.length === 0) {
    console.log("  ✓ config.json matches installed hooks");
    return false;
  }

  for (const m of mismatches) {
    if (m.hooksInstalled && !m.configEnabled) {
      console.log(`  ✗ ${m.name}: hooks installed but config says disabled`);
    } else if (!m.hooksInstalled && m.configEnabled) {
      console.log(`  ✗ ${m.name}: config says enabled but hooks not installed`);
    }
  }
  console.log("  Run `shaka doctor --fix` to update config.json to match.");
  return true;
}

async function fixConfigAlignment(
  shakaHome: string,
  mismatches: ProviderMismatch[],
): Promise<void> {
  const configPath = `${shakaHome}/config.json`;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    console.log("\n  ✗ Cannot fix: config.json not found. Run `shaka init` first.");
    return;
  }

  const config = await file.json();

  for (const m of mismatches) {
    config.providers[m.name].enabled = m.hooksInstalled;
    console.log(`\n  ✓ Set ${m.name}.enabled = ${m.hooksInstalled}`);
  }

  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("  ✓ config.json updated");
}

async function checkProviders(config: ShakaConfig | null): Promise<boolean> {
  let hasIssues = false;
  const providers = getAllProviders();

  for (const provider of providers) {
    const installed = await provider.isInstalled();
    const hookStatus = await provider.verifyHooks();
    const enabled = config?.providers[provider.name].enabled ?? false;
    const providerHasIssues = logProviderStatus(provider, installed, hookStatus, enabled);
    hasIssues = hasIssues || providerHasIssues;
  }

  return hasIssues;
}

async function recheckAfterFix(shakaHome: string): Promise<boolean> {
  const config = await loadConfig(shakaHome);
  let hasIssues = await checkShakaHome(shakaHome);
  const providers = getAllProviders();

  for (const provider of providers) {
    const installed = await provider.isInstalled();
    const hookStatus = await provider.verifyHooks();
    const enabled = config?.providers[provider.name].enabled ?? false;
    if (enabled && installed && hookStatus.issues.length > 0) hasIssues = true;
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
  return new Command("doctor")
    .description("Check Shaka installation health")
    .option("--fix", "Auto-fix config mismatches")
    .action(async (options) => {
      console.log("Shaka Doctor\n");
      console.log("Checking system health...\n");

      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });

      let hasIssues = await checkShakaHome(shakaHome);

      const config = await loadConfig(shakaHome);

      console.log("\nProvider status:");
      const providerIssues = await checkProviders(config);
      hasIssues = hasIssues || providerIssues;

      const mismatches = await checkProviderConfigAlignment(config);
      const alignmentIssues = logConfigAlignment(mismatches);
      hasIssues = hasIssues || alignmentIssues;

      if (options.fix && mismatches.length > 0) {
        await fixConfigAlignment(shakaHome, mismatches);
        hasIssues = await recheckAfterFix(shakaHome);
      }

      printSummary(hasIssues);
      await printOpencodeSummarizationHint(shakaHome);
    });
}
