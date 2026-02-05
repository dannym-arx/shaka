/**
 * Semver utilities and git version detection.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a semver string (e.g., "1.2.3") into components.
 * Returns null for invalid input.
 */
export function parseSemver(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Check if upgrading from `from` to `to` is a major version change.
 * Returns false if either version is unparseable.
 */
export function isMajorUpgrade(from: string, to: string): boolean {
  const fromVer = parseSemver(from);
  const toVer = parseSemver(to);

  if (!fromVer || !toVer) return false;

  return toVer.major > fromVer.major;
}

/**
 * Compare two semver versions. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b.
 * Returns 0 if either is unparseable.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) return 0;

  if (av.major !== bv.major) return av.major < bv.major ? -1 : 1;
  if (av.minor !== bv.minor) return av.minor < bv.minor ? -1 : 1;
  if (av.patch !== bv.patch) return av.patch < bv.patch ? -1 : 1;
  return 0;
}

/**
 * Get the current shaka version from package.json.
 */
export function getCurrentVersion(): string {
  const pkgPath = new URL("../../package.json", import.meta.url).pathname;
  const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Run a git command and return trimmed stdout, or null on failure. */
async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return (await new Response(proc.stdout).text()).trim() || null;
  } catch {
    return null;
  }
}

/** Strip leading "v" from a tag name. */
function stripV(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export interface GitRef {
  /** "tag" when HEAD matches a vX.Y.Z tag, "commit" otherwise */
  type: "tag" | "commit";
  /** The tag name (e.g. "v0.1.0") or short commit hash (e.g. "a1b2c3d") */
  label: string;
}

/**
 * Detect what git ref we're running on.
 * Returns the tag name if HEAD is at a vX.Y.Z tag, otherwise the short commit hash.
 * Returns null if not in a git repo or git unavailable.
 */
export async function getGitRef(repoRoot: string): Promise<GitRef | null> {
  const tag = await git(["describe", "--tags", "--exact-match", "HEAD"], repoRoot);
  if (tag) return { type: "tag", label: tag };

  const hash = await git(["rev-parse", "--short", "HEAD"], repoRoot);
  if (hash) return { type: "commit", label: hash };

  return null;
}

/**
 * Find the latest local vX.Y.Z tag by version sort.
 * Local only — no network calls. Returns null if no tags exist.
 */
export async function findLatestTag(repoRoot: string): Promise<string | null> {
  const output = await git(["tag", "-l", "v*.*.*", "--sort=-version:refname"], repoRoot);
  if (!output) return null;

  for (const tag of output.split("\n")) {
    if (parseSemver(stripV(tag))) return tag;
  }

  return null;
}

/**
 * Find the latest local tag newer than the current version.
 * Local only — no network calls. Returns null if no newer tag exists.
 */
export async function findNewerLocalTag(repoRoot: string): Promise<string | null> {
  const tag = await findLatestTag(repoRoot);
  if (!tag) return null;

  return compareSemver(stripV(tag), getCurrentVersion()) > 0 ? tag : null;
}
