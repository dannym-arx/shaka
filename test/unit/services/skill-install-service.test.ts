import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "../../../src/domain/result";
import { loadManifest } from "../../../src/domain/skills-manifest";
import { validateSkillStructure } from "../../../src/services/skill-pipeline";
import {
  type ScanResult,
  installSkill,
  scanForExecutableContent,
} from "../../../src/services/skill-install-service";
import { createGitHubProvider } from "../../../src/services/skill-source/github";

const VALID_SKILL_MD = `---
name: TestSkill
description: A test skill
key: test-skill
---

# TestSkill

Some content here.
`;

const NO_NAME_SKILL_MD = `---
description: Missing name
---

# Oops
`;

/** Fake git clone that writes a SKILL.md into the dest directory. */
function fakeGitClone(skillMd: string = VALID_SKILL_MD) {
  return async (_url: string, dest: string, _ref: string | null) => {
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "SKILL.md"), skillMd);
    return ok(undefined);
  };
}

/** Fake git clone that writes files into a subdirectory. */
function fakeGitCloneWithSubdir(subdir: string, skillMd: string = VALID_SKILL_MD) {
  return async (_url: string, dest: string, _ref: string | null) => {
    await mkdir(join(dest, subdir), { recursive: true });
    await writeFile(join(dest, subdir, "SKILL.md"), skillMd);
    return ok(undefined);
  };
}

/** Fake git clone that writes extra files alongside SKILL.md. */
function fakeGitCloneWithFiles(files: Record<string, string>) {
  return async (_url: string, dest: string, _ref: string | null) => {
    await mkdir(dest, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(dest, path);
      const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content);
    }
    return ok(undefined);
  };
}

const FAKE_SHA = "abc123def456";
const fakeRevParse = async (_cwd: string) => ok(FAKE_SHA);

/** Create a GitHub provider with mocked git for testing. */
function testProvider(gitClone = fakeGitClone()) {
  return createGitHubProvider({ gitClone, gitRevParse: fakeRevParse });
}

describe("SkillInstallService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `shaka-test-install-${Date.now()}`);
    await mkdir(join(tempDir, "skills"), { recursive: true });
    await mkdir(join(tempDir, "system", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("installSkill", () => {
    test("installs a valid skill from shorthand URL", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("TestSkill");
        expect(result.value.skill.source).toBe("user/repo");
        expect(result.value.skill.version).toBe(FAKE_SHA);
      }
    });

    test("installs skill and updates manifest", async () => {
      await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      const manifest = await loadManifest(tempDir);
      expect(manifest.ok).toBe(true);
      if (manifest.ok) {
        expect(manifest.value.skills.TestSkill).toBeDefined();
        expect(manifest.value.skills.TestSkill?.source).toBe("user/repo");
      }
    });

    test("copies SKILL.md to skills/<name>/", async () => {
      await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      const skillMd = Bun.file(join(tempDir, "skills", "TestSkill", "SKILL.md"));
      expect(await skillMd.exists()).toBe(true);
    });

    test("handles subdirectory in URL", async () => {
      const result = await installSkill(tempDir, "https://github.com/user/repo/tree/main/skills/my-skill", {
        provider: testProvider(fakeGitCloneWithSubdir("skills/my-skill")),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("TestSkill");
      }
    });

    test("fails on missing SKILL.md", async () => {
      const emptyClone = async (_url: string, dest: string, _ref: string | null) => {
        await mkdir(dest, { recursive: true });
        return ok(undefined);
      };

      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(emptyClone),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("SKILL.md");
      }
    });

    test("fails on SKILL.md without name field", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitClone(NO_NAME_SKILL_MD)),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('"name" field');
      }
    });

    test("fails on system skill name collision", async () => {
      // Create a system skill with the same name
      await mkdir(join(tempDir, "system", "skills", "TestSkill"), { recursive: true });
      await writeFile(join(tempDir, "system", "skills", "TestSkill", "SKILL.md"), VALID_SKILL_MD);

      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("conflicts with a built-in system skill");
      }
    });

    test("fails on already-installed skill", async () => {
      // Install once
      await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      // Install again
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("already installed");
      }
    });

    test("does not leave temp directory in shakaHome", async () => {
      await installSkill(tempDir, "user/repo", {
        provider: testProvider(),
      });

      // Temp dir is in OS tmpdir, not in shakaHome
      const tmpDir = join(tempDir, ".tmp");
      const file = Bun.file(tmpDir);
      expect(await file.exists()).toBe(false);
    });
  });

  describe("security scan", () => {
    test("allows text-only skills", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "notes.txt": "notes",
          "config.yaml": "key: value",
        })),
      });

      expect(result.ok).toBe(true);
    });

    test("aborts with --safe-only when executable files found", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "setup.sh": "#!/bin/bash\necho hi",
        })),
        safeOnly: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("non-text files");
        expect(result.error.message).toContain("--safe-only");
      }
    });

    test("installs with --force despite executable files", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "hook.ts": "console.log('hi')",
        })),
        force: true,
      });

      expect(result.ok).toBe(true);
    });

    test("calls confirm callback when executable files found", async () => {
      let confirmCalled = false;
      const scanArgs: ScanResult[] = [];

      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "run.py": "print('hi')",
        })),
        confirm: async (scan) => {
          confirmCalled = true;
          scanArgs.push(scan);
          return true;
        },
      });

      expect(confirmCalled).toBe(true);
      expect(scanArgs[0]?.executable).toContain("run.py");
      expect(result.ok).toBe(true);
    });

    test("aborts when confirm returns false", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "evil.sh": "rm -rf /",
        })),
        confirm: async () => false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("cancelled by user");
      }
    });

    test("defaults to cancelled when no confirm callback and not --force", async () => {
      const result = await installSkill(tempDir, "user/repo", {
        provider: testProvider(fakeGitCloneWithFiles({
          "SKILL.md": VALID_SKILL_MD,
          "script.js": "alert(1)",
        })),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("cancelled by user");
      }
    });
  });

  describe("scanForExecutableContent", () => {
    test("classifies safe extensions correctly", async () => {
      const dir = join(tempDir, "scan-safe");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "readme.md"), "hi");
      await writeFile(join(dir, "data.json"), "{}");
      await writeFile(join(dir, "config.yaml"), "");
      await writeFile(join(dir, "notes.txt"), "");

      const scan = await scanForExecutableContent(dir);
      expect(scan.safe).toHaveLength(4);
      expect(scan.executable).toHaveLength(0);
      expect(scan.unknown).toHaveLength(0);
    });

    test("classifies executable extensions correctly", async () => {
      const dir = join(tempDir, "scan-exec");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "hook.ts"), "");
      await writeFile(join(dir, "run.sh"), "");
      await writeFile(join(dir, "setup.py"), "");

      const scan = await scanForExecutableContent(dir);
      expect(scan.executable).toHaveLength(3);
      expect(scan.executable).toContain("hook.ts");
      expect(scan.executable).toContain("run.sh");
      expect(scan.executable).toContain("setup.py");
    });

    test("classifies unknown extensions correctly", async () => {
      const dir = join(tempDir, "scan-unknown");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "image.png"), "");
      await writeFile(join(dir, "data.bin"), "");

      const scan = await scanForExecutableContent(dir);
      expect(scan.unknown).toHaveLength(2);
    });

    test("treats files without extension as safe", async () => {
      const dir = join(tempDir, "scan-noext");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "LICENSE"), "MIT");
      await writeFile(join(dir, "README"), "hi");

      const scan = await scanForExecutableContent(dir);
      expect(scan.safe).toHaveLength(2);
    });

    test("scans subdirectories recursively", async () => {
      const dir = join(tempDir, "scan-nested");
      await mkdir(join(dir, "sub"), { recursive: true });
      await writeFile(join(dir, "SKILL.md"), "hi");
      await writeFile(join(dir, "sub", "hook.ts"), "");

      const scan = await scanForExecutableContent(dir);
      expect(scan.safe).toContain("SKILL.md");
      expect(scan.executable).toContain("sub/hook.ts");
    });

    test("ignores .git directory", async () => {
      const dir = join(tempDir, "scan-git");
      await mkdir(join(dir, ".git", "objects"), { recursive: true });
      await writeFile(join(dir, ".git", "HEAD"), "ref");
      await writeFile(join(dir, "SKILL.md"), "hi");

      const scan = await scanForExecutableContent(dir);
      expect(scan.safe).toHaveLength(1);
      expect(scan.executable).toHaveLength(0);
    });
  });

  describe("validateSkillStructure", () => {
    test("passes for valid SKILL.md with name", async () => {
      const dir = join(tempDir, "valid-skill");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), VALID_SKILL_MD);

      const result = await validateSkillStructure(dir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("TestSkill");
      }
    });

    test("fails when SKILL.md is missing", async () => {
      const dir = join(tempDir, "no-skill");
      await mkdir(dir, { recursive: true });

      const result = await validateSkillStructure(dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Missing SKILL.md");
      }
    });

    test("fails when name field is missing", async () => {
      const dir = join(tempDir, "bad-skill");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), NO_NAME_SKILL_MD);

      const result = await validateSkillStructure(dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('"name" field');
      }
    });
  });
});
