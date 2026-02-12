/**
 * Skill deployment helpers.
 *
 * Source-agnostic operations for deploying fetched skills:
 * validate structure, copy files, persist to manifest, and cleanup.
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Result, err, ok } from "../domain/result";
import {
  type InstalledSkill,
  addSkill,
  loadManifest,
  saveManifest,
} from "../domain/skills-manifest";

/** Remove a temp directory, swallowing errors. */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Copy skill files to skills/<name>/, replacing any existing content.
 */
export async function installSkillFiles(
  skillSourceDir: string,
  shakaHome: string,
  skillName: string,
): Promise<void> {
  const targetDir = join(shakaHome, "skills", skillName);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await copySkillFiles(skillSourceDir, targetDir);
}

/**
 * Add or update a skill entry in the manifest and save to disk.
 */
export async function persistToManifest(
  shakaHome: string,
  skillName: string,
  skill: InstalledSkill,
): Promise<Result<{ name: string; skill: InstalledSkill }, Error>> {
  const manifestResult = await loadManifest(shakaHome);
  if (!manifestResult.ok) return manifestResult;

  const updatedManifest = addSkill(manifestResult.value, skillName, skill);
  const saveResult = await saveManifest(shakaHome, updatedManifest);
  if (!saveResult.ok) return saveResult;

  return ok({ name: skillName, skill });
}

/**
 * Validate that a directory contains a valid SKILL.md with required frontmatter.
 */
export async function validateSkillStructure(
  skillPath: string,
): Promise<Result<{ name: string }, Error>> {
  const skillMdPath = join(skillPath, "SKILL.md");
  const file = Bun.file(skillMdPath);

  if (!(await file.exists())) {
    return err(new Error("Missing SKILL.md in skill directory."));
  }

  const content = await file.text();
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter || typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
    return err(new Error('SKILL.md must have a "name" field in frontmatter.'));
  }

  return ok({ name: frontmatter.name.trim() });
}

// --- Internal helpers ---

async function copySkillFiles(source: string, target: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    await cp(join(source, entry.name), join(target, entry.name), { recursive: true });
  }
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: Record<string, string> = {};
  const lines = (match[1] as string).split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}
