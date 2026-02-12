import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "../../../src/domain/result";
import {
  type InstalledSkill,
  addSkill,
  emptyManifest,
  loadManifest,
  saveManifest,
} from "../../../src/domain/skills-manifest";
import { updateAllSkills, updateSkill } from "../../../src/services/skill-update-service";
import { createGitHubProvider } from "../../../src/services/skill-source/github";

const VALID_SKILL_MD = `---
name: TestSkill
description: A test skill
---

# TestSkill
`;

const ORIGINAL_SHA = "aaa111";
const UPDATED_SHA = "bbb222";

const TEST_SKILL: InstalledSkill = {
  source: "user/repo",
  provider: "github",
  version: ORIGINAL_SHA,
  subdirectory: null,
  installedAt: "2026-02-11T00:00:00.000Z",
};

function fakeGitClone(skillMd: string = VALID_SKILL_MD) {
  return async (_url: string, dest: string, _ref: string | null) => {
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "SKILL.md"), skillMd);
    return ok(undefined);
  };
}

/** Create a GitHub provider with mocked git for testing. */
function testProvider(revParseSha: string = UPDATED_SHA, gitClone = fakeGitClone()) {
  return createGitHubProvider({
    gitClone,
    gitRevParse: async () => ok(revParseSha),
  });
}

describe("SkillUpdateService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `shaka-test-update-${Date.now()}`);
    await mkdir(join(tempDir, "skills"), { recursive: true });
    await mkdir(join(tempDir, "system", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function installFakeSkill(name: string, skill: InstalledSkill = TEST_SKILL): Promise<void> {
    const skillDir = join(tempDir, "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD);

    const manifest = addSkill(emptyManifest(), name, skill);
    await saveManifest(tempDir, manifest);
  }

  describe("updateSkill", () => {
    test("updates skill with new commit", async () => {
      await installFakeSkill("TestSkill");

      const result = await updateSkill(tempDir, "TestSkill", {
        provider: testProvider(UPDATED_SHA),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.previousVersion).toBe(ORIGINAL_SHA);
        expect(result.value.newVersion).toBe(UPDATED_SHA);
        expect(result.value.upToDate).toBe(false);
      }
    });

    test("reports up-to-date when commit matches", async () => {
      await installFakeSkill("TestSkill");

      const result = await updateSkill(tempDir, "TestSkill", {
        provider: testProvider(ORIGINAL_SHA),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.upToDate).toBe(true);
      }
    });

    test("updates manifest with new commit SHA", async () => {
      await installFakeSkill("TestSkill");

      await updateSkill(tempDir, "TestSkill", {
        provider: testProvider(UPDATED_SHA),
      });

      const manifest = await loadManifest(tempDir);
      expect(manifest.ok).toBe(true);
      if (manifest.ok) {
        expect(manifest.value.skills.TestSkill?.version).toBe(UPDATED_SHA);
      }
    });

    test("does not update manifest when up-to-date", async () => {
      await installFakeSkill("TestSkill");

      await updateSkill(tempDir, "TestSkill", {
        provider: testProvider(ORIGINAL_SHA),
      });

      const manifest = await loadManifest(tempDir);
      expect(manifest.ok).toBe(true);
      if (manifest.ok) {
        expect(manifest.value.skills.TestSkill?.version).toBe(ORIGINAL_SHA);
      }
    });

    test("fails when skill not installed", async () => {
      const result = await updateSkill(tempDir, "NonExistent", {
        provider: testProvider(UPDATED_SHA),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("not installed");
      }
    });

    test("replaces skill files on disk", async () => {
      await installFakeSkill("TestSkill");

      const updatedMd = `---\nname: TestSkill\ndescription: Updated\n---\n# Updated`;
      await updateSkill(tempDir, "TestSkill", {
        provider: testProvider(UPDATED_SHA, fakeGitClone(updatedMd)),
      });

      const content = await Bun.file(
        join(tempDir, "skills", "TestSkill", "SKILL.md"),
      ).text();
      expect(content).toContain("Updated");
    });
  });

  describe("updateAllSkills", () => {
    test("updates all installed skills", async () => {
      // Install two skills
      const skillDirA = join(tempDir, "skills", "SkillA");
      const skillDirB = join(tempDir, "skills", "SkillB");
      await mkdir(skillDirA, { recursive: true });
      await mkdir(skillDirB, { recursive: true });
      await writeFile(join(skillDirA, "SKILL.md"), `---\nname: SkillA\n---`);
      await writeFile(join(skillDirB, "SKILL.md"), `---\nname: SkillB\n---`);

      let manifest = addSkill(emptyManifest(), "SkillA", TEST_SKILL);
      manifest = addSkill(manifest, "SkillB", { ...TEST_SKILL, source: "other/repo" });
      await saveManifest(tempDir, manifest);

      const result = await updateAllSkills(tempDir, {
        provider: testProvider(UPDATED_SHA),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((r) => r.newVersion === UPDATED_SHA)).toBe(true);
      }
    });

    test("returns empty array when no skills installed", async () => {
      const result = await updateAllSkills(tempDir, {
        provider: testProvider(UPDATED_SHA),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });
});
