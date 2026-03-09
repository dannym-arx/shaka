/**
 * Clawdhub skill source provider.
 *
 * Fetches skills from the Clawdhub registry (clawhub.ai) via HTTP.
 * Skills are distributed as ZIP archives containing SKILL.md + supporting files.
 *
 * API:
 *   GET /api/v1/skills/{slug}                          → { latestVersion: { version } }
 *   GET /api/v1/download?slug=<slug>&version=<version> → ZIP bytes
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result, err, ok } from "../../domain/result";
import { cleanupTempDir } from "../skill-pipeline";
import type { FetchResult, SkillSourceProvider } from "./types";

const DEFAULT_REGISTRY = "https://clawhub.ai";

/** Parsed Clawdhub input: slug + optional version. */
export interface ClawdhubInput {
  slug: string;
  version: string | undefined;
}

/**
 * Fetches a skill from the registry to a local directory.
 * Returns the resolved version string.
 */
export type ClawdhubFetchFn = (
  slug: string,
  version: string | undefined,
  destDir: string,
) => Promise<Result<{ version: string }, Error>>;

export interface ClawdhubProviderOptions {
  /** Override the registry URL (default: https://clawhub.ai, env: CLAWHUB_REGISTRY). */
  registryUrl?: string;
  /** Override fetch+extract for testing. */
  fetchSkill?: ClawdhubFetchFn;
}

/** Parse a Clawdhub input string into slug and optional version. */
export function parseClawdhubInput(input: string): ClawdhubInput {
  const trimmed = input.trim();
  const atIdx = trimmed.lastIndexOf("@");

  if (atIdx > 0) {
    return {
      slug: trimmed.slice(0, atIdx).toLowerCase(),
      version: trimmed.slice(atIdx + 1),
    };
  }

  return { slug: trimmed.toLowerCase(), version: undefined };
}

/** Create a Clawdhub skill source provider. */
export function createClawdhubProvider(options: ClawdhubProviderOptions = {}): SkillSourceProvider {
  const registryUrl = options.registryUrl ?? process.env.CLAWHUB_REGISTRY ?? DEFAULT_REGISTRY;
  const fetchSkillFn = options.fetchSkill ?? createDefaultFetchSkill(registryUrl);

  return {
    name: "clawdhub",

    canHandle(input: string): boolean {
      const trimmed = input.trim();
      // Bare words only — no slashes, no URL schemes
      return (
        !trimmed.includes("/") && !trimmed.startsWith("https://") && !trimmed.startsWith("git@")
      );
    },

    async fetch(input: string): Promise<Result<FetchResult, Error>> {
      const { slug, version } = parseClawdhubInput(input);

      const tempDir = join(tmpdir(), `shaka-clawdhub-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });

      const result = await fetchSkillFn(slug, version, tempDir);
      if (!result.ok) {
        await cleanupTempDir(tempDir);
        return result;
      }

      return ok({
        skillDir: tempDir,
        tempDir,
        version: result.value.version,
        source: slug,
        subdirectory: null,
      });
    },
  };
}

// --- Default implementations ---

function createDefaultFetchSkill(registryUrl: string): ClawdhubFetchFn {
  return async (slug, version, destDir) => {
    // 1. Resolve version if not specified via skill metadata endpoint
    let resolvedVersion: string;
    if (version) {
      resolvedVersion = version;
    } else {
      const metaUrl = `${registryUrl}/api/v1/skills/${encodeURIComponent(slug)}`;
      const metaRes = await safeFetch(metaUrl);
      if (!metaRes.ok) return metaRes;

      const body = (await metaRes.value.json()) as {
        latestVersion: { version: string } | null;
      };
      if (!body.latestVersion) {
        return err(new Error(`No published version found for "${slug}"`));
      }
      resolvedVersion = body.latestVersion.version;
    }

    // 2. Download ZIP
    const downloadUrl = `${registryUrl}/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(resolvedVersion)}`;
    const downloadRes = await safeFetch(downloadUrl);
    if (!downloadRes.ok) return downloadRes;

    // 3. Extract ZIP
    const zipBytes = new Uint8Array(await downloadRes.value.arrayBuffer());
    const zipPath = join(destDir, "_download.zip");
    await Bun.write(zipPath, zipBytes);

    try {
      await Bun.$`unzip -o ${zipPath} -d ${destDir}`.quiet();
    } catch (e) {
      return err(new Error(`Failed to extract ZIP: ${e instanceof Error ? e.message : String(e)}`));
    } finally {
      await rm(zipPath, { force: true }).catch(() => {});
    }

    return ok({ version: resolvedVersion });
  };
}

async function safeFetch(url: string): Promise<Result<Response, Error>> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return err(new Error(`HTTP ${res.status}: ${res.statusText} (${url})`));
    }
    return ok(res);
  } catch (e) {
    return err(new Error(`Network error: ${e instanceof Error ? e.message : String(e)}`));
  }
}
