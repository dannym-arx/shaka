/**
 * SkillSourceProvider interface and related types.
 *
 * A skill source provider knows how to fetch skills from a specific source
 * (GitHub, Clawdhub, etc.) and resolve version information for updates.
 *
 * All providers converge on the same FetchResult — the downstream pipeline
 * (validate, scan, deploy, persist) is source-agnostic.
 */

import type { Result } from "../../domain/result";

/** Result of fetching a skill from any source provider. */
export interface FetchResult {
  /** Path to the directory containing SKILL.md. */
  readonly skillDir: string;
  /** Root temp directory to clean up after deployment. */
  readonly tempDir: string;
  /** Provider-specific version identifier (commit SHA, semver, etc.). */
  readonly version: string;
  /** Normalized source string to store in the manifest. */
  readonly source: string;
  /** Subdirectory within the source, if applicable. Null if root. */
  readonly subdirectory: string | null;
}

/** Options passed to a provider's fetch method. */
export interface FetchOptions {
  /** Callback to let user choose from multiple skills (e.g., marketplace repos). */
  selectSkill?: (skills: { name: string; description?: string }[]) => Promise<string | null>;
  /** Subdirectory hint — used during updates to skip auto-detection. */
  subdirectory?: string | null;
}

/** A provider that can fetch skills from a specific source. */
export interface SkillSourceProvider {
  /** Provider name (e.g., "github", "clawdhub"). Used in manifest. */
  readonly name: string;

  /** Return true if this provider can handle the given input string. */
  canHandle(input: string): boolean;

  /** Fetch skill content to a temp directory. */
  fetch(input: string, options?: FetchOptions): Promise<Result<FetchResult, Error>>;
}
