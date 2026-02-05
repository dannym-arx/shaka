#!/usr/bin/env bun
/**
 * SessionStart hook for Claude Code
 * Loads system context and user files, outputs additionalContext for the session.
 */

import {
  getAssistantName,
  getPrincipalName,
  isSubagent,
  loadShakaFile,
  resolveShakaHome,
} from "shaka";

/** Hook trigger events - Shaka canonical names (provider configurers handle conversion) */
export const TRIGGER = ["session.start"] as const;
export const HOOK_VERSION = "0.4.0";

/**
 * Load all markdown files from user/ directory.
 */
async function loadUserFiles(shakaHome: string): Promise<string[]> {
  const userDir = `${shakaHome}/user`;
  const contents: string[] = [];

  try {
    const glob = new Bun.Glob("*.md");
    for await (const file of glob.scan({ cwd: userDir })) {
      const content = await Bun.file(`${userDir}/${file}`).text();
      if (content.trim()) {
        contents.push(content);
        console.error(`  ✓ user/${file}`);
      }
    }
  } catch {
    // user/ directory doesn't exist yet - that's ok
  }

  return contents;
}

async function main() {
  // Skip context loading for subagent sessions
  if (isSubagent()) {
    console.error("🤖 Subagent session - skipping context loading");
    process.exit(0);
  }

  const shakaHome = resolveShakaHome();
  const contextParts: string[] = [];

  // Load system reasoning framework (with customization override support)
  const reasoning = await loadShakaFile("system/base-reasoning-framework.md", shakaHome);
  if (reasoning) {
    contextParts.push(reasoning);
    console.error("✅ Loaded system/base-reasoning-framework.md");
  }

  // Load all user files
  console.error("📂 Loading user files...");
  const userFiles = await loadUserFiles(shakaHome);
  contextParts.push(...userFiles);

  if (contextParts.length === 0) {
    console.error("⚠️ No context files loaded");
    process.exit(0);
  }

  // Get identity from config
  const [principalName, assistantName] = await Promise.all([
    getPrincipalName(shakaHome),
    getAssistantName(shakaHome),
  ]);

  // Get current date/time (uses system locale and timezone)
  const currentDate = new Date().toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });

  // Join all context with separators
  const contextContent = contextParts.join("\n\n---\n\n");

  const systemReminder = `<system-reminder>
SHAKA CONTEXT (Auto-loaded at Session Start)

📅 CURRENT DATE/TIME: ${currentDate}

## IDENTITY

- User: **${principalName}**
- Assistant: **${assistantName}**

---

${contextContent}

---

This context is now active.
</system-reminder>`;

  console.log(systemReminder);
  console.error("✅ Shaka context loaded");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  });
}
