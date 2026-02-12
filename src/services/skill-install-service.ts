/**
 * Skill install service.
 *
 * Delegates fetching to a SkillSourceProvider, then runs the common pipeline:
 * validate → security scan → collision check → deploy → persist.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Result, err, ok } from "../domain/result";
import type { InstalledSkill } from "../domain/skills-manifest";
import { loadManifest } from "../domain/skills-manifest";
import { linkSkillToProviders } from "./skill-linker";
import {
  cleanupTempDir,
  installSkillFiles,
  persistToManifest,
  validateSkillStructure,
} from "./skill-pipeline";
import { detectProvider } from "./skill-source";
import type { SkillSourceProvider } from "./skill-source/types";

export interface ScanResult {
  safe: string[];
  executable: string[];
  unknown: string[];
}

export interface InstallOptions {
  /** Skip security scan prompt and install regardless. */
  force?: boolean;
  /** Abort if any non-text files are found (for scripted usage). */
  safeOnly?: boolean;
  /** Callback for confirming installation when executable files are found. */
  confirm?: (scan: ScanResult) => Promise<boolean>;
  /** Callback to let user choose from multiple skills (marketplace repos). */
  selectSkill?: (skills: { name: string; description?: string }[]) => Promise<string | null>;
  /** Override auto-detected provider (e.g., from --github or --clawdhub flag). */
  provider?: SkillSourceProvider;
}

const SAFE_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json", ".xml", ".csv", ".toml"]);

const EXECUTABLE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
]);

export async function installSkill(
  shakaHome: string,
  input: string,
  options: InstallOptions = {},
): Promise<Result<{ name: string; skill: InstalledSkill }, Error>> {
  // Detect or use provided provider
  let provider: SkillSourceProvider;
  if (options.provider) {
    provider = options.provider;
  } else {
    const detected = detectProvider(input);
    if (!detected.ok) return detected;
    provider = detected.value;
  }

  // Fetch from provider
  const fetchResult = await provider.fetch(input, { selectSkill: options.selectSkill });
  if (!fetchResult.ok) return fetchResult;

  try {
    // Validate SKILL.md
    const validation = await validateSkillStructure(fetchResult.value.skillDir);
    if (!validation.ok) return validation;

    // Security scan
    const scanResult = await enforceSecurityScan(fetchResult.value.skillDir, options);
    if (!scanResult.ok) return scanResult;

    // Check for name collision
    const collisionResult = await checkNameCollision(shakaHome, validation.value.name);
    if (!collisionResult.ok) return collisionResult;

    // Deploy, persist, and link to providers
    await installSkillFiles(fetchResult.value.skillDir, shakaHome, validation.value.name);
    await linkSkillToProviders(shakaHome, validation.value.name);

    return await persistToManifest(shakaHome, validation.value.name, {
      source: fetchResult.value.source,
      provider: provider.name,
      version: fetchResult.value.version,
      subdirectory: fetchResult.value.subdirectory,
      installedAt: new Date().toISOString(),
    });
  } finally {
    await cleanupTempDir(fetchResult.value.tempDir);
  }
}

/**
 * Scan a skill directory for non-text files.
 */
export async function scanForExecutableContent(skillPath: string): Promise<ScanResult> {
  const result: ScanResult = { safe: [], executable: [], unknown: [] };

  const entries = await collectFiles(skillPath);
  for (const relativePath of entries) {
    const ext = extname(relativePath);

    if (SAFE_EXTENSIONS.has(ext) || ext === "") {
      result.safe.push(relativePath);
    } else if (EXECUTABLE_EXTENSIONS.has(ext)) {
      result.executable.push(relativePath);
    } else {
      result.unknown.push(relativePath);
    }
  }

  return result;
}

// --- Internal helpers ---

async function enforceSecurityScan(
  skillPath: string,
  options: InstallOptions,
): Promise<Result<void, Error>> {
  const scan = await scanForExecutableContent(skillPath);
  const hasRiskyFiles = scan.executable.length > 0 || scan.unknown.length > 0;

  if (!hasRiskyFiles) return ok(undefined);

  if (options.safeOnly) {
    const flagged = [...scan.executable, ...scan.unknown].join(", ");
    return err(new Error(`Skill contains non-text files (${flagged}). Aborting (--safe-only).`));
  }

  if (options.force) return ok(undefined);

  const confirmed = options.confirm ? await options.confirm(scan) : false;
  if (!confirmed) {
    return err(new Error("Installation cancelled by user."));
  }
  return ok(undefined);
}

async function checkNameCollision(shakaHome: string, name: string): Promise<Result<void, Error>> {
  const systemSkillPath = join(shakaHome, "system", "skills", name);
  if (await Bun.file(join(systemSkillPath, "SKILL.md")).exists()) {
    return err(new Error(`Skill "${name}" conflicts with a built-in system skill.`));
  }

  const manifest = await loadManifest(shakaHome);
  if (manifest.ok && manifest.value.skills[name]) {
    return err(new Error(`Skill "${name}" is already installed. Remove it first or use update.`));
  }

  return ok(undefined);
}

async function collectFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(join(dir, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot <= 0 || dot === path.length - 1) return "";
  return path.slice(dot).toLowerCase();
}
