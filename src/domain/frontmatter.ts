/**
 * Standard YAML frontmatter parser for human-authored command files.
 *
 * Expects `---\nYAML\n---\nbody` format. Does NOT handle LLM-output
 * resilience (that's summarize.ts's domain).
 */

import { parse as parseYaml } from "yaml";

/** Parse standard YAML frontmatter delimited by --- markers. */
export function parseFrontmatter(
  raw: string,
): { frontmatter: Record<string, unknown>; body: string } | null {
  const content = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match?.[1]) return null;
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      frontmatter: parsed as Record<string, unknown>,
      body: match[2] ?? "",
    };
  } catch {
    return null;
  }
}
