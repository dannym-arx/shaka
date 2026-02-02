#!/usr/bin/env bun
/**
 * SessionStart hook for Claude Code
 * @version 0.1.0
 *
 * Loads context files defined in config.json and outputs them as additionalContext.
 * Follows PAI v2.5 patterns: contextFiles array, identity injection, subagent detection.
 *
 * Customizations override system files: customizations/ > system/
 */

export const HOOK_VERSION = "0.1.0";

const SHAKA_HOME =
  process.env.SHAKA_HOME || `${process.env.HOME}/.config/shaka`;

interface Config {
  version?: string;
  contextFiles?: string[];
  assistant?: { name?: string };
  principal?: { name?: string; timezone?: string };
}

/**
 * Load a file from SHAKA_HOME.
 * For system/ paths: check customizations/ override first, then system/.
 * For user/ paths: load directly from user/.
 */
async function loadFile(relativePath: string): Promise<string | null> {
  // If it's a system file, check for customization override
  if (relativePath.startsWith("system/")) {
    const basename = relativePath.replace("system/", "");
    const customPath = `${SHAKA_HOME}/customizations/${basename}`;
    const customFile = Bun.file(customPath);
    if (await customFile.exists()) {
      console.error(`  (using customization override)`);
      return customFile.text();
    }
  }

  // Load from the path as-is
  const fullPath = `${SHAKA_HOME}/${relativePath}`;
  const file = Bun.file(fullPath);
  if (await file.exists()) {
    return file.text();
  }

  return null;
}

/**
 * Load and parse config.json.
 */
async function loadConfig(): Promise<Config> {
  const configPath = `${SHAKA_HOME}/config.json`;
  const file = Bun.file(configPath);

  if (await file.exists()) {
    try {
      return await file.json();
    } catch (err) {
      console.error(`⚠️ Failed to parse config.json: ${err}`);
    }
  }

  return {};
}

/**
 * Load all context files from config.contextFiles array.
 */
async function loadContextFiles(config: Config): Promise<string> {
  const defaultFiles = ["system/base-reasoning-framework.md"];
  const contextFiles = config.contextFiles || defaultFiles;

  const contents: string[] = [];

  for (const relativePath of contextFiles) {
    const content = await loadFile(relativePath);
    if (content) {
      contents.push(content);
      console.error(`✅ Loaded ${relativePath}`);
    } else {
      console.error(`⚠️ Not found: ${relativePath}`);
    }
  }

  return contents.join("\n\n---\n\n");
}

async function main() {
  // Check if subagent session - skip context loading
  const isSubagent =
    process.env.CLAUDE_PROJECT_DIR?.includes("/.claude/Agents/") ||
    process.env.CLAUDE_AGENT_TYPE !== undefined;

  if (isSubagent) {
    console.error("🤖 Subagent session - skipping context loading");
    process.exit(0);
  }

  // Load config
  const config = await loadConfig();

  // Load context files
  const contextContent = await loadContextFiles(config);

  if (!contextContent) {
    console.error("⚠️ No context files loaded");
    process.exit(0);
  }

  // Extract identity from config
  const principalName = config.principal?.name || "User";
  const assistantName = config.assistant?.name || "Shaka";

  // Get current date/time
  const currentDate = new Date().toLocaleString("en-US", {
    timeZone: config.principal?.timezone || "America/Los_Angeles",
    dateStyle: "full",
    timeStyle: "short",
  });

  // Build system reminder
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

  // Output for Claude Code hook
  const output = {
    hookSpecificOutput: {
      additionalContext: systemReminder,
    },
  };

  console.log(JSON.stringify(output));
  console.error("✅ Shaka context loaded");
}

main().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
