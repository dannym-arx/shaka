import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "../../../../src/domain/result";
import {
  createClawhubProvider,
  parseClawhubInput,
} from "../../../../src/services/skill-source/clawhub";

const VALID_SKILL_MD = `---
name: TestSkill
description: A test skill
---

# TestSkill
`;

/** Fake fetchSkill that writes a SKILL.md to destDir. */
function fakeFetchSkill(skillMd: string = VALID_SKILL_MD, resolvedVersion = "1.0.0") {
  return async (_slug: string, _version: string | undefined, destDir: string) => {
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "SKILL.md"), skillMd);
    return ok({ version: resolvedVersion });
  };
}

/** Fake fetchSkill that returns a specific version (version param or default). */
function fakeFetchSkillWithVersion(resolvedVersion: string) {
  return async (_slug: string, version: string | undefined, destDir: string) => {
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "SKILL.md"), VALID_SKILL_MD);
    return ok({ version: version ?? resolvedVersion });
  };
}

describe("ClawhubSourceProvider", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `shaka-test-clawhub-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseClawhubInput", () => {
    test("parses bare slug", () => {
      const result = parseClawhubInput("sonoscli");
      expect(result.slug).toBe("sonoscli");
      expect(result.version).toBeUndefined();
    });

    test("parses slug with version", () => {
      const result = parseClawhubInput("sonoscli@1.2.0");
      expect(result.slug).toBe("sonoscli");
      expect(result.version).toBe("1.2.0");
    });

    test("parses slug with latest tag", () => {
      const result = parseClawhubInput("myskill@latest");
      expect(result.slug).toBe("myskill");
      expect(result.version).toBe("latest");
    });

    test("handles leading/trailing whitespace", () => {
      const result = parseClawhubInput("  sonoscli@1.0.0  ");
      expect(result.slug).toBe("sonoscli");
      expect(result.version).toBe("1.0.0");
    });

    test("handles slug without @ as bare slug", () => {
      const result = parseClawhubInput("my-cool-skill");
      expect(result.slug).toBe("my-cool-skill");
      expect(result.version).toBeUndefined();
    });

    test("normalizes slug to lowercase", () => {
      const result = parseClawhubInput("Trello");
      expect(result.slug).toBe("trello");
    });

    test("normalizes slug to lowercase with version", () => {
      const result = parseClawhubInput("Trello@1.0.0");
      expect(result.slug).toBe("trello");
      expect(result.version).toBe("1.0.0");
    });
  });

  describe("canHandle", () => {
    const provider = createClawhubProvider();

    test("returns true for bare word", () => {
      expect(provider.canHandle("sonoscli")).toBe(true);
    });

    test("returns true for bare word with version", () => {
      expect(provider.canHandle("sonoscli@1.2.0")).toBe(true);
    });

    test("returns true for hyphenated name", () => {
      expect(provider.canHandle("my-cool-skill")).toBe(true);
    });

    test("returns false for user/repo shorthand", () => {
      expect(provider.canHandle("user/repo")).toBe(false);
    });

    test("returns false for HTTPS URL", () => {
      expect(provider.canHandle("https://github.com/user/repo")).toBe(false);
    });

    test("returns false for SSH URL", () => {
      expect(provider.canHandle("git@github.com:user/repo.git")).toBe(false);
    });
  });

  describe("fetch", () => {
    test("fetches skill and returns FetchResult", async () => {
      const provider = createClawhubProvider({
        fetchSkill: fakeFetchSkill(),
      });

      const result = await provider.fetch("sonoscli");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe("1.0.0");
        expect(result.value.source).toBe("sonoscli");
        expect(result.value.subdirectory).toBeNull();
        expect(await Bun.file(join(result.value.skillDir, "SKILL.md")).exists()).toBe(true);
        await rm(result.value.tempDir, { recursive: true, force: true });
      }
    });

    test("passes version from input to fetchSkill", async () => {
      let receivedVersion: string | undefined;
      const provider = createClawhubProvider({
        fetchSkill: async (slug, version, destDir) => {
          receivedVersion = version;
          await mkdir(destDir, { recursive: true });
          await writeFile(join(destDir, "SKILL.md"), VALID_SKILL_MD);
          return ok({ version: version ?? "2.0.0" });
        },
      });

      const result = await provider.fetch("sonoscli@1.2.0");

      expect(receivedVersion).toBe("1.2.0");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe("1.2.0");
        await rm(result.value.tempDir, { recursive: true, force: true });
      }
    });

    test("passes undefined version for bare slug", async () => {
      let receivedVersion: string | undefined = "not-called";
      const provider = createClawhubProvider({
        fetchSkill: async (_slug, version, destDir) => {
          receivedVersion = version;
          await mkdir(destDir, { recursive: true });
          await writeFile(join(destDir, "SKILL.md"), VALID_SKILL_MD);
          return ok({ version: "3.0.0" });
        },
      });

      await provider.fetch("sonoscli");

      expect(receivedVersion).toBeUndefined();
    });

    test("passes slug without version suffix", async () => {
      let receivedSlug = "";
      const provider = createClawhubProvider({
        fetchSkill: async (slug, _version, destDir) => {
          receivedSlug = slug;
          await mkdir(destDir, { recursive: true });
          await writeFile(join(destDir, "SKILL.md"), VALID_SKILL_MD);
          return ok({ version: "1.0.0" });
        },
      });

      await provider.fetch("sonoscli@1.2.0");

      expect(receivedSlug).toBe("sonoscli");
    });

    test("propagates fetchSkill errors", async () => {
      const provider = createClawhubProvider({
        fetchSkill: async () => {
          return { ok: false as const, error: new Error("Download failed: 404") };
        },
      });

      const result = await provider.fetch("nonexistent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("404");
      }
    });

    test("cleans up temp dir on fetchSkill failure", async () => {
      let capturedDestDir = "";
      const provider = createClawhubProvider({
        fetchSkill: async (_slug, _version, destDir) => {
          capturedDestDir = destDir;
          return { ok: false as const, error: new Error("fail") };
        },
      });

      await provider.fetch("sonoscli");

      // Temp dir should be cleaned up
      expect(await Bun.file(capturedDestDir).exists()).toBe(false);
    });

    test("cleans up temp dir and returns err when fetchSkill throws", async () => {
      let capturedDestDir = "";
      const provider = createClawhubProvider({
        fetchSkill: async (_slug, _version, destDir) => {
          capturedDestDir = destDir;
          await mkdir(destDir, { recursive: true });
          throw new Error("boom");
        },
      });

      const result = await provider.fetch("sonoscli");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("boom");
      }
      expect(await Bun.file(capturedDestDir).exists()).toBe(false);
    });
  });
});
