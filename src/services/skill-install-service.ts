/**
 * Skill install service.
 *
 * Delegates fetching to a SkillSourceProvider, then runs the common pipeline:
 * validate → security checks → collision check → deploy → persist.
 */

import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
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

export interface SecurityCheckEntry {
  emoji: string;
  label: string;
  passed: boolean;
  details: string[];
  failureMessage: string;
}

export interface SecurityReport {
  checks: SecurityCheckEntry[];
  allPassed: boolean;
}

/** Sentinel error signalling the install was cancelled via callback. */
export class InstallCancelledError extends Error {
  override name = "InstallCancelledError";
  constructor(message = "Installation cancelled.") {
    super(message);
  }
}

export interface InstallOptions {
  /** Skip all security checks and confirmation prompt. */
  yolo?: boolean;
  /** Called with security check results and skill name. Return true to proceed. */
  onSecurityCheck?: (report: SecurityReport, skillName: string) => Promise<boolean>;
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

    // Security checks (unless --yolo)
    if (!options.yolo) {
      const securityResult = await enforceSecurityChecks(
        fetchResult.value.skillDir,
        validation.value.name,
        options,
      );
      if (!securityResult.ok) return securityResult;
    }

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
    const ext = extname(relativePath).toLowerCase();

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

// --- Security checks ---

/**
 * Run all security checks on a skill directory.
 */
export async function runSecurityChecks(skillPath: string): Promise<SecurityReport> {
  const checks = await Promise.all([
    checkExecutables(skillPath),
    checkUrls(skillPath),
    checkHtmlComments(skillPath),
    checkInvisibleChars(skillPath),
  ]);
  return {
    checks,
    allPassed: checks.every((c) => c.passed),
  };
}

async function checkExecutables(skillPath: string): Promise<SecurityCheckEntry> {
  const scan = await scanForExecutableContent(skillPath);
  const hasRisky = scan.executable.length > 0 || scan.unknown.length > 0;
  return {
    emoji: "\u{1F3C3}",
    label: "No executables",
    passed: !hasRisky,
    details: [...scan.executable, ...scan.unknown],
    failureMessage: "Skill contains executable files, make sure to review it properly.",
  };
}

async function checkUrls(skillPath: string): Promise<SecurityCheckEntry> {
  const files = await collectFiles(skillPath);
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
  const flagged: string[] = [];
  const pattern = /https?:\/\//;
  for (const file of mdFiles) {
    const content = await Bun.file(join(skillPath, file)).text();
    if (pattern.test(content)) {
      flagged.push(file);
    }
  }
  return {
    emoji: "\u{1F517}",
    label: "No URLs",
    passed: flagged.length === 0,
    details: flagged,
    failureMessage: "Skill contains URLs in markdown, make sure to review it properly.",
  };
}

async function checkHtmlComments(skillPath: string): Promise<SecurityCheckEntry> {
  const files = await collectFiles(skillPath);
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
  const flagged: string[] = [];
  for (const file of mdFiles) {
    const content = await Bun.file(join(skillPath, file)).text();
    if (content.includes("<!--")) {
      flagged.push(file);
    }
  }
  return {
    emoji: "\u{1F977}",
    label: "No html comments",
    passed: flagged.length === 0,
    details: flagged,
    failureMessage: "Skill has HTML comments in markdown, make sure to review it properly.",
  };
}

/**
 * Zero-width and bidirectional override characters that can hide content.
 * Note: U+200C (ZWNJ) and U+200D (ZWJ) are excluded because they have
 * legitimate uses in non-Latin scripts (Arabic, Hindi, etc.).
 */
const INVISIBLE_CHARS =
  /[\u200B\u200E\u200F\u2028\u2029\u2060\u2066\u2067\u2068\u2069\u206A-\u206F\uFEFF\u00AD]/;

async function checkInvisibleChars(skillPath: string): Promise<SecurityCheckEntry> {
  const files = await collectFiles(skillPath);
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
  const flagged: string[] = [];
  for (const file of mdFiles) {
    const content = await Bun.file(join(skillPath, file)).text();
    if (INVISIBLE_CHARS.test(content)) {
      flagged.push(file);
    }
  }
  return {
    emoji: "\u{1F47B}",
    label: "No invisible chars",
    passed: flagged.length === 0,
    details: flagged,
    failureMessage: "Skill contains invisible unicode characters, make sure to review it properly.",
  };
}

// --- Internal helpers ---

async function enforceSecurityChecks(
  skillPath: string,
  skillName: string,
  options: InstallOptions,
): Promise<Result<void, Error>> {
  const report = await runSecurityChecks(skillPath);
  if (options.onSecurityCheck) {
    const proceed = await options.onSecurityCheck(report, skillName);
    if (!proceed) return err(new InstallCancelledError());
  } else if (!report.allPassed) {
    return err(new Error("Security checks failed."));
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
