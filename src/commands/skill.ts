/**
 * CLI handler for `shaka skill` command group.
 *
 * Subcommands: install, remove, update, list.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { loadManifest } from "../domain/skills-manifest";
import { type ScanResult, installSkill } from "../services/skill-install-service";
import { removeSkill } from "../services/skill-remove-service";
import { getProviderByName } from "../services/skill-source";
import { type UpdateResult, updateAllSkills, updateSkill } from "../services/skill-update-service";

function getShakaHome(): string {
  return resolveShakaHome({
    SHAKA_HOME: process.env.SHAKA_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  });
}

export function createSkillCommand(): Command {
  const skill = new Command("skill").description("Manage installed skills");

  skill
    .command("install")
    .description("Install a skill (auto-detects source)")
    .argument("<source>", "Skill source (user/repo, URL, or clawdhub slug)")
    .option("--force", "Skip security scan prompt", false)
    .option("--safe-only", "Abort if non-text files found", false)
    .option("--github", "Force GitHub provider")
    .option("--clawdhub", "Force Clawdhub provider")
    .action(handleInstall);

  skill
    .command("remove")
    .description("Remove an installed skill")
    .argument("<name>", "Skill name")
    .action(handleRemove);

  skill
    .command("update")
    .description("Update one or all installed skills")
    .argument("[name]", "Skill name (omit to update all)")
    .action(handleUpdate);

  skill.command("list").description("List all skills (system + installed)").action(handleList);

  return skill;
}

async function handleInstall(
  source: string,
  opts: { force: boolean; safeOnly: boolean; github?: boolean; clawdhub?: boolean },
): Promise<void> {
  const shakaHome = getShakaHome();

  // Resolve provider override from flags
  const providerOverride = resolveProviderFlag(opts);
  if (providerOverride && !providerOverride.ok) {
    console.error(`✗ ${providerOverride.error.message}`);
    process.exit(1);
  }

  console.log(`Installing skill from ${source}...`);

  const result = await installSkill(shakaHome, source, {
    force: opts.force,
    safeOnly: opts.safeOnly,
    provider: providerOverride?.ok ? providerOverride.value : undefined,
    confirm: async (scan) => {
      console.log(formatScanWarning(scan));
      process.stdout.write("\nProceed with installation? [y/N] ");
      const answer = await readLine();
      return answer.toLowerCase() === "y";
    },
  });

  if (!result.ok) {
    console.error(`\n✗ ${result.error.message}`);
    process.exit(1);
  }

  const ver = result.value.skill.version.slice(0, 7);
  console.log(`\n✓ Installed skill "${result.value.name}" (${ver})`);
}

async function handleRemove(name: string): Promise<void> {
  const shakaHome = getShakaHome();

  const result = await removeSkill(shakaHome, name);
  if (!result.ok) {
    console.error(`✗ ${result.error.message}`);
    process.exit(1);
  }

  console.log(`✓ Removed skill "${name}"`);
}

async function handleUpdate(name?: string): Promise<void> {
  const shakaHome = getShakaHome();

  if (name) {
    const result = await updateSkill(shakaHome, name);
    if (!result.ok) {
      console.error(`✗ ${result.error.message}`);
      process.exit(1);
    }
    printUpdateResult(result.value);
  } else {
    const result = await updateAllSkills(shakaHome);
    if (!result.ok) {
      console.error(`✗ ${result.error.message}`);
      process.exit(1);
    }
    if (result.value.length === 0) {
      console.log("No installed skills to update.");
      return;
    }
    for (const r of result.value) {
      printUpdateResult(r);
    }
  }
}

async function handleList(): Promise<void> {
  const shakaHome = getShakaHome();

  const systemSkills = await listSkillDirs(join(shakaHome, "system", "skills"));
  const manifest = await loadManifest(shakaHome);
  const installedSkills = manifest.ok ? Object.entries(manifest.value.skills) : [];

  if (systemSkills.length === 0 && installedSkills.length === 0) {
    console.log("No skills found.");
    return;
  }

  if (systemSkills.length > 0) {
    console.log("System skills:");
    for (const name of systemSkills) {
      console.log(`  ${name}`);
    }
  }

  if (installedSkills.length > 0) {
    if (systemSkills.length > 0) console.log("");
    console.log("Installed skills:");
    for (const [name, skill] of installedSkills) {
      const ver = skill.version.slice(0, 7);
      console.log(`  ${name}  (${skill.provider}: ${skill.source}, ${ver})`);
    }
  }
}

// --- Helpers ---

function resolveProviderFlag(opts: { github?: boolean; clawdhub?: boolean }) {
  if (opts.github && opts.clawdhub) {
    return { ok: false as const, error: new Error("Cannot use both --github and --clawdhub") };
  }
  if (opts.github) return getProviderByName("github");
  if (opts.clawdhub) return getProviderByName("clawdhub");
  return null;
}

function printUpdateResult(r: UpdateResult): void {
  if (r.upToDate) {
    console.log(`  ✓ "${r.name}" is up to date (${r.newVersion.slice(0, 7)})`);
  } else {
    const from = r.previousVersion.slice(0, 7);
    const to = r.newVersion.slice(0, 7);
    console.log(`  ✓ Updated "${r.name}" (${from} → ${to})`);
  }
}

function formatScanWarning(scan: ScanResult): string {
  const lines = ["\n⚠  This skill contains non-text files:\n"];
  for (const file of scan.executable) {
    lines.push(`  executable: ${file}`);
  }
  for (const file of scan.unknown) {
    lines.push(`  unknown:    ${file}`);
  }
  lines.push("\nThese files could execute code on your machine.");
  return lines.join("\n");
}

async function listSkillDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      resolve(chunk.toString().trim());
    });
    setTimeout(() => resolve(""), 30000);
  });
}
