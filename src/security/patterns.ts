/**
 * Security pattern matching utilities.
 * Pure functions for matching commands and paths against security patterns.
 */

import { homedir } from "node:os";

/**
 * Test if text matches a pattern (regex or substring).
 */
export function matchesPattern(text: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return regex.test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

/**
 * Expand ~ to home directory in a path.
 */
export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

/**
 * Test if a file path matches a pattern (supports ~ and * globs).
 */
export function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = expandPath(pattern);
  const expandedPath = expandPath(filePath);

  if (pattern.includes("*")) {
    // Convert glob to regex
    const regexPattern = expandedPattern
      .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
      .replace(/\*/g, "<<<SINGLESTAR>>>")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/<<<DOUBLESTAR>>>/g, ".*")
      .replace(/<<<SINGLESTAR>>>/g, "[^/]*");

    try {
      return new RegExp(`^${regexPattern}$`).test(expandedPath);
    } catch {
      return false;
    }
  }

  // Exact match or prefix match for directories
  return expandedPath === expandedPattern || expandedPath.startsWith(`${expandedPattern}/`);
}
