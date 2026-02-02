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
export async function isProviderInstalled(provider: ProviderName): Promise<boolean> {
  const result = await Bun.$`which ${provider}`.quiet().nothrow();
  return result.exitCode === 0;
}

/**
 * Detect all installed provider CLIs.
 * Results are cached for the session.
 */
export async function detectInstalledProviders(): Promise<DetectedProviders> {
  if (cachedDetection) {
    return cachedDetection;
  }

  const [claude, opencode] = await Promise.all([
    isProviderInstalled("claude"),
    isProviderInstalled("opencode"),
  ]);

  cachedDetection = { claude, opencode };
  return cachedDetection;
}

/**
 * Clear the detection cache.
 * Useful for testing or when providers may have been installed/uninstalled.
 */
export function clearDetectionCache(): void {
  cachedDetection = null;
}
