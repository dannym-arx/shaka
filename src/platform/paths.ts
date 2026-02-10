/**
 * Cross-platform path utilities.
 *
 * The `new URL(..., import.meta.url).pathname` pattern produces invalid paths
 * on Windows (e.g., `/C:/Users/...` instead of `C:\Users\...`).
 * `fileURLToPath()` handles this correctly on all platforms.
 */

import { fileURLToPath } from "node:url";
export { join, sep } from "node:path";

/**
 * Resolve a relative path from a module's location.
 * Use instead of `new URL(relative, import.meta.url).pathname`.
 *
 * @param base - The module's `import.meta.url`
 * @param relative - Relative path from the module (e.g., "../../defaults")
 */
export function resolveFromModule(base: string, relative: string): string {
  return fileURLToPath(new URL(relative, base));
}
