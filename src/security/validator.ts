/**
 * Security validation logic.
 * Validates commands and paths against security patterns.
 */

import { matchesPathPattern, matchesPattern } from "./patterns";

export interface Pattern {
  pattern: string;
  reason: string;
}

export interface PatternsConfig {
  version: string;
  bash: {
    blocked: Pattern[];
    confirm: Pattern[];
    alert: Pattern[];
  };
  paths: {
    zeroAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  };
}

export type ValidationAction = "allow" | "block" | "confirm" | "alert";

export interface ValidationResult {
  action: ValidationAction;
  reason?: string;
}

/**
 * Validate a bash command against security patterns.
 */
export function validateBashCommand(command: string, patterns: PatternsConfig): ValidationResult {
  for (const p of patterns.bash.blocked) {
    if (matchesPattern(command, p.pattern)) {
      return { action: "block", reason: p.reason };
    }
  }

  for (const p of patterns.bash.confirm) {
    if (matchesPattern(command, p.pattern)) {
      return { action: "confirm", reason: p.reason };
    }
  }

  for (const p of patterns.bash.alert) {
    if (matchesPattern(command, p.pattern)) {
      return { action: "alert", reason: p.reason };
    }
  }

  return { action: "allow" };
}

/**
 * Check if path matches any pattern in the list.
 */
function findMatchingPattern(filePath: string, patterns: string[]): string | null {
  for (const p of patterns) {
    if (matchesPathPattern(filePath, p)) {
      return p;
    }
  }
  return null;
}

/**
 * Validate a file path for a specific operation.
 */
export function validatePath(
  filePath: string,
  operation: "read" | "write" | "delete",
  patterns: PatternsConfig,
): ValidationResult {
  // Zero access - complete denial (any operation)
  const zeroAccessMatch = findMatchingPattern(filePath, patterns.paths.zeroAccess);
  if (zeroAccessMatch) {
    return { action: "block", reason: `Protected path: ${zeroAccessMatch}` };
  }

  // Read-only paths (block write/delete)
  if (operation === "write" || operation === "delete") {
    const readOnlyMatch = findMatchingPattern(filePath, patterns.paths.readOnly);
    if (readOnlyMatch) {
      return { action: "block", reason: `Read-only path: ${readOnlyMatch}` };
    }
  }

  // Confirm write
  if (operation === "write") {
    const confirmMatch = findMatchingPattern(filePath, patterns.paths.confirmWrite);
    if (confirmMatch) {
      return { action: "confirm", reason: `Writing to protected file: ${confirmMatch}` };
    }
  }

  // No delete
  if (operation === "delete") {
    const noDeleteMatch = findMatchingPattern(filePath, patterns.paths.noDelete);
    if (noDeleteMatch) {
      return { action: "block", reason: `Cannot delete protected path: ${noDeleteMatch}` };
    }
  }

  return { action: "allow" };
}

/**
 * Create an empty patterns config (fail-open default).
 */
export function emptyPatternsConfig(): PatternsConfig {
  return {
    version: "0.0",
    bash: { blocked: [], confirm: [], alert: [] },
    paths: { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
  };
}
