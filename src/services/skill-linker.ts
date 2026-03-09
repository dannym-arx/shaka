/**
 * Links/unlinks installed skills to provider skill directories.
 *
 * Bridge between the provider-agnostic install pipeline and
 * provider-specific discovery mechanisms. Each enabled provider
 * gets a per-skill symlink so skills appear as direct children
 * of the provider's skills directory.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../domain/config";
import { installAssetSymlink, uninstallAssetSymlink } from "../providers/asset-installer";

interface ProviderSkillDir {
  skillsDir: string;
}

function getAllProviderSkillDirs(env: NodeJS.ProcessEnv = process.env): ProviderSkillDir[] {
  const dirs: ProviderSkillDir[] = [];

  dirs.push({ skillsDir: join(homedir(), ".claude", "skills") });

  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode");
  dirs.push({ skillsDir: join(base, "skills") });

  return dirs;
}

function getEnabledProviderSkillDirs(
  config: { providers: { claude: { enabled: boolean }; opencode: { enabled: boolean } } },
  env: NodeJS.ProcessEnv = process.env,
): ProviderSkillDir[] {
  const allDirs = getAllProviderSkillDirs(env);
  const dirs: ProviderSkillDir[] = [];

  if (config.providers.claude.enabled) {
    dirs.push(allDirs[0] as ProviderSkillDir);
  }

  if (config.providers.opencode.enabled) {
    dirs.push(allDirs[1] as ProviderSkillDir);
  }

  return dirs;
}

/**
 * Create a per-skill symlink in each enabled provider's skills directory.
 * Called after `shaka skill install` so the skill is immediately discoverable.
 */
export async function linkSkillToProviders(shakaHome: string, skillName: string): Promise<void> {
  const config = await loadConfig(shakaHome);
  if (!config) return;

  const sourceDir = join(shakaHome, "skills", skillName);
  for (const { skillsDir } of getEnabledProviderSkillDirs(config)) {
    await installAssetSymlink(sourceDir, skillsDir, skillName);
  }
}

/**
 * Remove the per-skill symlink from each enabled provider's skills directory.
 * Called after `shaka skill remove` so the skill disappears from providers.
 */
export async function unlinkSkillFromProviders(
  shakaHome: string,
  skillName: string,
): Promise<void> {
  const config = await loadConfig(shakaHome);
  if (!config) return;

  const sourceDir = join(shakaHome, "skills", skillName);
  for (const { skillsDir } of getAllProviderSkillDirs()) {
    await uninstallAssetSymlink(sourceDir, skillsDir, skillName);
  }
}
