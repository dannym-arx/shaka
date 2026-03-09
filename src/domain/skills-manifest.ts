/**
 * Skills manifest for tracking installed skills.
 *
 * Stored at SHAKA_HOME/skills.json.
 * Tracks source, version, and metadata for each installed skill.
 */

import { join } from "node:path";
import { type Result, err, ok } from "./result";

/** A skill installed from any source provider. */
export interface InstalledSkill {
  /** Normalized source identifier (e.g. "user/repo", "sonoscli"). */
  readonly source: string;
  /** Provider that installed this skill (e.g. "github", "clawhub"). */
  readonly provider: string;
  /** Provider-specific version identifier (commit SHA, semver, etc.). */
  readonly version: string;
  /** Path within the source if the skill is not at the root. Null if root. */
  readonly subdirectory: string | null;
  /** ISO 8601 timestamp of when the skill was installed. */
  readonly installedAt: string;
}

/** Tracks all user-installed skills. Stored at SHAKA_HOME/skills.json. */
export interface SkillsManifest {
  /** Schema version for forward compatibility. Currently 1. */
  readonly version: number;
  /** Map of skill directory name → installation metadata. */
  readonly skills: Record<string, InstalledSkill>;
}

const MANIFEST_VERSION = 1;
const MANIFEST_FILE = "skills.json";

function manifestPath(shakaHome: string): string {
  return join(shakaHome, MANIFEST_FILE);
}

export function emptyManifest(): SkillsManifest {
  return { version: MANIFEST_VERSION, skills: {} };
}

export async function loadManifest(shakaHome: string): Promise<Result<SkillsManifest, Error>> {
  const path = manifestPath(shakaHome);

  try {
    const file = Bun.file(path);
    const exists = await file.exists();

    if (!exists) {
      return ok(emptyManifest());
    }

    const raw = await file.json();

    if (typeof raw !== "object" || raw === null) {
      return err(new Error("Invalid skills manifest: expected object"));
    }

    if (raw.version !== MANIFEST_VERSION) {
      return err(
        new Error(
          `Unsupported skills manifest version: ${raw.version} (expected ${MANIFEST_VERSION})`,
        ),
      );
    }

    return ok(raw as SkillsManifest);
  } catch (e) {
    return err(
      new Error(`Failed to read skills manifest: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}

export async function saveManifest(
  shakaHome: string,
  manifest: SkillsManifest,
): Promise<Result<void, Error>> {
  const path = manifestPath(shakaHome);

  try {
    await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
    return ok(undefined);
  } catch (e) {
    return err(
      new Error(`Failed to write skills manifest: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}

export function addSkill(
  manifest: SkillsManifest,
  name: string,
  skill: InstalledSkill,
): SkillsManifest {
  return {
    ...manifest,
    skills: { ...manifest.skills, [name]: skill },
  };
}

export function removeSkill(manifest: SkillsManifest, name: string): SkillsManifest {
  const { [name]: _, ...rest } = manifest.skills;
  return { ...manifest, skills: rest };
}
