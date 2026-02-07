/**
 * CLI handler for `shaka init` command.
 *
 * Sets up shaka from current state. Idempotent — safe to run anytime.
 * For safe upgrades with version checking, use `shaka update`.
 */

import { createInterface } from "node:readline";
import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { findNewerLocalTag, getGitRef } from "../domain/version";
import { createProvider } from "../providers/registry";
import type { ProviderName } from "../providers/types";
import { type InitResult, InitService } from "../services/init-service";
import { type DetectedProviders, detectInstalledProviders } from "../services/provider-detection";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  claude: "Claude Code",
  opencode: "opencode",
};

function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Resolve which providers to install from CLI flags.
 * Returns null when interactive prompt is needed.
 */
function resolveProvidersFromFlags(
  options: { claude?: boolean; opencode?: boolean; all?: boolean },
  detected: DetectedProviders,
): ProviderName[] | null {
  const wantClaude = options.claude || options.all;
  const wantOpencode = options.opencode || options.all;

  if (!wantClaude && !wantOpencode) return null;

  const selected: ProviderName[] = [];
  const warnings: string[] = [];

  if (wantClaude) {
    if (detected.claude) {
      selected.push("claude");
    } else {
      warnings.push("Claude Code is not installed.");
    }
  }

  if (wantOpencode) {
    if (detected.opencode) {
      selected.push("opencode");
    } else {
      warnings.push("opencode is not installed.");
    }
  }

  for (const w of warnings) {
    console.log(`  ⚠ ${w}`);
  }

  if (selected.length === 0) {
    console.error("\nERROR: No selected providers are available.");
    console.error("Install Claude Code or opencode first.");
    process.exit(1);
  }

  return selected;
}

/**
 * Interactive provider selection when no flags are given.
 */
async function promptProviderSelection(detected: DetectedProviders): Promise<ProviderName[]> {
  const available: ProviderName[] = [];
  if (detected.claude) available.push("claude");
  if (detected.opencode) available.push("opencode");

  if (available.length === 0) {
    console.error("ERROR: No AI providers detected. Install Claude Code or opencode first.");
    process.exit(1);
  }

  console.log("Detected providers:");
  console.log(`  Claude Code: ${detected.claude ? "✓ available" : "✗ not found"}`);
  console.log(`  opencode:    ${detected.opencode ? "✓ available" : "✗ not found"}`);
  console.log();

  if (available.length === 1) {
    const name = available[0] as ProviderName;
    const label = PROVIDER_LABELS[name];
    console.log(`Only ${label} is available — installing it.\n`);
    return available;
  }

  // Both available — let user choose
  console.log("Which providers do you want to install?");
  console.log("  1. Claude Code");
  console.log("  2. opencode");
  console.log("  3. Both");
  console.log();

  const answer = await prompt("Select [1/2/3]: ");

  switch (answer) {
    case "1":
      return ["claude"];
    case "2":
      return ["opencode"];
    case "3":
      return ["claude", "opencode"];
    default:
      console.log(
        "Invalid selection. Use 1, 2, or 3. (Or re-run with --claude, --opencode, or --all)",
      );
      process.exit(1);
  }
}

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

async function logVersionInfo(result: InitResult): Promise<void> {
  const repoRoot = new URL("../..", import.meta.url).pathname;
  const ref = await getGitRef(repoRoot);
  const refLabel = ref
    ? ref.type === "tag"
      ? ref.label
      : `v${result.currentVersion} (${ref.label})`
    : `v${result.currentVersion}`;

  console.log(`\n✅ Shaka initialized successfully — running on ${refLabel}`);

  const newerTag = await findNewerLocalTag(repoRoot);
  if (newerTag) {
    console.log(`   Update available: ${newerTag}. Run \`shaka update\` to upgrade.`);
  }
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize Shaka configuration")
    .option("--claude", "Install hooks for Claude Code")
    .option("--opencode", "Install hooks for opencode")
    .option("--all", "Install hooks for all detected providers")
    .option("--force", "Overwrite existing configuration")
    .action(async (options) => {
      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });

      console.log("Initializing Shaka...\n");

      const detected = await detectInstalledProviders();
      const flagProviders = resolveProvidersFromFlags(options, detected);
      const selectedProviders = flagProviders ?? (await promptProviderSelection(detected));

      console.log();

      const initService = new InitService({ shakaHome });
      const result = await initService.init({
        providers: selectedProviders,
        force: options.force,
      });

      if (!result.ok) {
        console.error(`ERROR: ${result.error.message}`);
        process.exit(1);
      }

      logProviderStatus(result.value.providers);
      await installProviderHooks(result.value.providers, shakaHome);
      logCreatedItems(result.value);
      await logVersionInfo(result.value);
    });
}
