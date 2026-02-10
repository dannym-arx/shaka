/**
 * CLI hints and user guidance utilities.
 *
 * Presentation layer for showing helpful hints to users.
 */

import { loadConfig } from "../domain/config";

/**
 * Print the opencode summarization model hint if appropriate.
 *
 * Shows hint when:
 * - opencode is enabled
 * - summarization_model is "auto" or not set
 *
 * Call this after init, doctor, or update commands complete successfully.
 */
export async function printOpencodeSummarizationHint(shakaHome: string): Promise<void> {
  const config = await loadConfig(shakaHome);

  // Only show hint if opencode is enabled
  if (!config?.providers?.opencode?.enabled) {
    return;
  }

  // Check if summarization_model is "auto" (default) or not set
  const model = config.providers.opencode.summarization_model;
  if (model !== "auto" && model !== undefined) {
    return;
  }

  console.log();
  console.log('Hint: opencode summarization_model is set to "auto".');
  console.log("      For faster/cheaper session summaries, consider running:");
  console.log(
    "      shaka config set providers.opencode.summarization_model=openrouter/anthropic/claude-haiku-4.5",
  );
}
