import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkSkillToProviders, unlinkSkillFromProviders } from "../../../src/services/skill-linker";

describe("skill-linker", () => {
  const testShakaHome = join(tmpdir(), "shaka-test-linker-home");
  const testClaudeHome = join(tmpdir(), "shaka-test-linker-claude");

  beforeEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
    await rm(testClaudeHome, { recursive: true, force: true });

    // Create shaka home with config and a skill
    await mkdir(join(testShakaHome, "skills", "trello"), { recursive: true });
    await Bun.write(
      join(testShakaHome, "skills", "trello", "SKILL.md"),
      "# Trello",
    );
  });

  afterEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
    await rm(testClaudeHome, { recursive: true, force: true });
  });

  test("does nothing when config is missing", async () => {
    // No config.json → no providers to link to
    await linkSkillToProviders(testShakaHome, "trello");
    // Should not throw and not create any directories
  });

  test("does nothing when no providers are enabled", async () => {
    await Bun.write(
      join(testShakaHome, "config.json"),
      JSON.stringify({
        version: "1",
        reasoning: { enabled: true },
        providers: {
          claude: { enabled: false },
          opencode: { enabled: false },
        },
        assistant: { name: "Shaka" },
        principal: { name: "User" },
      }),
    );

    await linkSkillToProviders(testShakaHome, "trello");
    // No errors, no symlinks created
  });

  test("unlinkSkillFromProviders does nothing when config is missing", async () => {
    await unlinkSkillFromProviders(testShakaHome, "trello");
    // Should not throw
  });
});
