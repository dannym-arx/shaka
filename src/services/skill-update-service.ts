/**
 * Skill update service.
 *
 * Re-fetches an installed skill from its original source via the
 * appropriate provider and replaces the local copy.
 */

import { type Result, err, ok } from "../domain/result";
import { loadManifest } from "../domain/skills-manifest";
import { runSecurityChecks } from "./skill-install-service";
import {
  cleanupTempDir,
  installSkillFiles,
  persistToManifest,
  validateSkillStructure,
} from "./skill-pipeline";
import { getProviderByName } from "./skill-source";
import type { SkillSourceProvider } from "./skill-source/types";

export interface UpdateOptions {
  /** Override provider lookup for testing. */
  provider?: SkillSourceProvider;
}

export interface UpdateResult {
  name: string;
  previousVersion: string;
  newVersion: string;
  upToDate: boolean;
  /** Security warnings for the updated version (non-blocking). */
  warnings?: string[];
}

export async function updateSkill(
  shakaHome: string,
  name: string,
  options: UpdateOptions = {},
): Promise<Result<UpdateResult, Error>> {
  const manifestResult = await loadManifest(shakaHome);
  if (!manifestResult.ok) return manifestResult;

  const skill = manifestResult.value.skills[name];
  if (!skill) {
    return err(new Error(`Skill "${name}" is not installed.`));
  }

  // Resolve provider
  let provider: SkillSourceProvider;
  if (options.provider) {
    provider = options.provider;
  } else {
    const providerResult = getProviderByName(skill.provider);
    if (!providerResult.ok) return providerResult;
    provider = providerResult.value;
  }

  // Fetch latest from provider (passing stored subdirectory for update flow)
  const fetchResult = await provider.fetch(skill.source, { subdirectory: skill.subdirectory });
  if (!fetchResult.ok) return fetchResult;

  try {
    // Check if already up to date
    if (fetchResult.value.version === skill.version) {
      return ok({
        name,
        previousVersion: skill.version,
        newVersion: fetchResult.value.version,
        upToDate: true,
      });
    }

    // Validate structure
    const validation = await validateSkillStructure(fetchResult.value.skillDir);
    if (!validation.ok) return validation;

    // Security checks (warn but don't block — user already trusts this source)
    const report = await runSecurityChecks(fetchResult.value.skillDir);
    const warnings: string[] = [];
    if (!report.allPassed) {
      for (const check of report.checks.filter((c) => !c.passed)) {
        warnings.push(check.failureMessage);
      }
    }

    // Deploy and persist
    await installSkillFiles(fetchResult.value.skillDir, shakaHome, name);

    const persistResult = await persistToManifest(shakaHome, name, {
      ...skill,
      version: fetchResult.value.version,
      installedAt: new Date().toISOString(),
    });
    if (!persistResult.ok) return persistResult;

    return ok({
      name,
      previousVersion: skill.version,
      newVersion: fetchResult.value.version,
      upToDate: false,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } finally {
    await cleanupTempDir(fetchResult.value.tempDir);
  }
}

export interface UpdateAllResult {
  results: UpdateResult[];
  failures: { name: string; error: Error }[];
}

export async function updateAllSkills(
  shakaHome: string,
  options: UpdateOptions = {},
): Promise<Result<UpdateAllResult, Error>> {
  const manifestResult = await loadManifest(shakaHome);
  if (!manifestResult.ok) return manifestResult;

  const results: UpdateResult[] = [];
  const failures: { name: string; error: Error }[] = [];

  for (const name of Object.keys(manifestResult.value.skills)) {
    const result = await updateSkill(shakaHome, name, options);
    if (result.ok) {
      results.push(result.value);
    } else {
      failures.push({ name, error: result.error });
    }
  }

  return ok({ results, failures });
}
