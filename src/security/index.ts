/**
 * Security module - pattern matching and validation.
 */

export { matchesPattern, expandPath, matchesPathPattern } from "./patterns";
export {
  type Pattern,
  type PatternsConfig,
  type ValidationAction,
  type ValidationResult,
  validateBashCommand,
  validatePath,
  emptyPatternsConfig,
} from "./validator";
