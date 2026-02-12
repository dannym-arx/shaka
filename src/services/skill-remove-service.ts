/**
 * Skill remove service.
 *
 * Removes an installed skill from skills/ and the manifest.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type Result, err, ok } from "../domain/result";
import {
  type InstalledSkill,
  loadManifest,
  removeSkill as removeFromManifest,
  saveManifest,
} from "../domain/skills-manifest";
import { unlinkSkillFromProviders } from "./skill-linker";

export async function removeSkill(
  shakaHome: string,
  name: string,
): Promise<Result<InstalledSkill, Error>> {
  // Check if it's a system skill
  const systemSkillMd = join(shakaHome, "system", "skills", name, "SKILL.md");
  if (await Bun.file(systemSkillMd).exists()) {
    return err(new Error(`"${name}" is a built-in system skill and cannot be removed.`));
  }

  // Load manifest and verify skill exists
  const manifestResult = await loadManifest(shakaHome);
  if (!manifestResult.ok) return manifestResult;

  const skill = manifestResult.value.skills[name];
  if (!skill) {
    return err(new Error(`Skill "${name}" is not installed.`));
  }

  // Unlink from providers before removing source directory
  await unlinkSkillFromProviders(shakaHome, name);

  // Remove directory
  const skillDir = join(shakaHome, "skills", name);
  await rm(skillDir, { recursive: true, force: true });

  // Update manifest
  const updatedManifest = removeFromManifest(manifestResult.value, name);
  const saveResult = await saveManifest(shakaHome, updatedManifest);
  if (!saveResult.ok) return saveResult;

  return ok(skill);
}
