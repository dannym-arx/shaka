/**
 * Provider detection service.
 * Detects which AI provider CLIs are installed on the system.
 *
 * This is the shared detection logic used by both:
 * - shaka core (CLI commands)
 * - defaults/ templates (via import from 'shaka')
 */

export type ProviderName = "claude" | "opencode";

export interface DetectedProviders {
  claude: boolean;
  opencode: boolean;
}

// Cache detection results within a session
let cachedDetection: DetectedProviders | null = null;

/**
 * Check if a specific provider CLI is installed.
 */
export function isProviderInstalled(provider: ProviderName): boolean {
  return Bun.which(provider) !== null;
}

/**
 * Detect all installed provider CLIs.
 * Results are cached for the session.
 */
export function detectInstalledProviders(): DetectedProviders {
  if (cachedDetection) {
    return cachedDetection;
  }

  cachedDetection = {
    claude: isProviderInstalled("claude"),
    opencode: isProviderInstalled("opencode"),
  };
  return cachedDetection;
}

/**
 * Clear the detection cache.
 * Useful for testing or when providers may have been installed/uninstalled.
 */
export function clearDetectionCache(): void {
  cachedDetection = null;
}
