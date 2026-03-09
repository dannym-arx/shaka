/**
 * Skill deployment helpers.
 *
 * Source-agnostic operations for deploying fetched skills:
 * validate structure, copy files, persist to manifest, and cleanup.
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
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

  const name = frontmatter.name.trim();
  if (!isSafeSkillName(name)) {
    return err(new Error('SKILL.md "name" must be a safe directory name.'));
  }

  return ok({ name });
}

// --- Internal helpers ---

async function copySkillFiles(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;

    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      await copySkillFiles(sourcePath, targetPath);
      continue;
    }

    await cp(sourcePath, targetPath, { recursive: false });
  }
}

function isSafeSkillName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  if (isAbsolute(name)) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return true;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  try {
    const parsed = parseYaml(match[1] as string);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
