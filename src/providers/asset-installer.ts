/**
 * Shared utilities for installing/uninstalling agents and skills.
 * Used by both Claude and OpenCode provider configurers.
 *
 * Both agents and skills use directory symlinks for consistency:
 * - Agents: ~/.config/opencode/agents/shaka/ → ${shakaHome}/system/agents/
 * - Skills: ~/.config/opencode/skills/shaka/ → ${shakaHome}/system/skills/
 *
 * This means agent names include the "shaka/" prefix (e.g., "shaka/inference").
 */

import { access, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ComponentStatus } from "./types";

/**
 * Install an asset directory via symlink: ${targetDir}/shaka → ${sourceDir}
 *
 * Uses a symlink to avoid duplication and ensure updates are instant.
 * Silently preserves existing real directories (user's custom setup).
 *
 * @param sourceDir - Path to source directory (e.g., ${shakaHome}/system/agents)
 * @param targetDir - Path to parent directory (e.g., ~/.claude/agents)
 */
async function installAssetSymlink(sourceDir: string, targetDir: string): Promise<void> {
  const linkPath = join(targetDir, "shaka");

  // Check if source exists
  try {
    await access(sourceDir);
  } catch {
    return;
  }

  await mkdir(targetDir, { recursive: true });

  try {
    const stats = await lstat(linkPath);

    if (stats.isSymbolicLink()) {
      const currentTarget = await readlink(linkPath);
      if (resolve(currentTarget) === resolve(sourceDir)) {
        return;
      }
      // Wrong target — remove and re-create
      await rm(linkPath);
    } else {
      // Real directory exists — user has custom content, preserve it
      return;
    }
  } catch {
    // Doesn't exist — will create
  }

  await symlink(sourceDir, linkPath, "dir");
}

/**
 * Uninstall an asset symlink if it points to the source directory.
 * Preserves real directories (user customizations) and symlinks pointing elsewhere.
 *
 * @param sourceDir - Path to source directory
 * @param targetDir - Path to parent directory
 */
async function uninstallAssetSymlink(sourceDir: string, targetDir: string): Promise<void> {
  const linkPath = join(targetDir, "shaka");

  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      return;
    }

    const currentTarget = await readlink(linkPath);
    if (resolve(currentTarget) === resolve(sourceDir)) {
      await rm(linkPath);
    }
  } catch {
    // Doesn't exist — nothing to uninstall
  }
}

/**
 * Verify an asset symlink exists and points to the correct source directory.
 * Returns ok:true if symlink is correct OR if a real directory exists (user's custom setup).
 *
 * @param sourceDir - Expected symlink target (e.g., ${shakaHome}/system/agents)
 * @param targetDir - Parent directory containing the symlink (e.g., ~/.claude/agents)
 * @param assetName - Human-readable name for error messages (e.g., "agents", "skills")
 */
export async function verifyAssetSymlink(
  sourceDir: string,
  targetDir: string,
  assetName: string,
): Promise<ComponentStatus> {
  const linkPath = join(targetDir, "shaka");

  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      // Real directory — acceptable (user's custom setup)
      return { ok: true };
    }

    const currentTarget = await readlink(linkPath);
    if (resolve(currentTarget) !== resolve(sourceDir)) {
      return {
        ok: false,
        issue: `${assetName} symlink points to wrong location: ${currentTarget}`,
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, issue: `shaka ${assetName} symlink not found` };
  }
}

export { installAssetSymlink, uninstallAssetSymlink };
