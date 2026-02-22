import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("shaka commands new", () => {
  const testHome = join(tmpdir(), `shaka-test-cmd-new-${process.pid}`);

  beforeEach(async () => {
    await rm(testHome, { recursive: true, force: true });
    await mkdir(join(testHome, "customizations", "commands"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  test("scaffold file is valid frontmatter", async () => {
    const { parseFrontmatter } = await import("../../../src/domain/frontmatter");

    const scaffold = `---
description: TODO
---

TODO: Add your command prompt here.

$ARGUMENTS
`;
    const result = parseFrontmatter(scaffold);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.description).toBe("TODO");
    expect(result!.body).toContain("$ARGUMENTS");
  });
});

describe("shaka commands disable/enable config updates", () => {
  const testHome = join(tmpdir(), `shaka-test-cmd-toggle-${process.pid}`);

  beforeEach(async () => {
    await rm(testHome, { recursive: true, force: true });
    await mkdir(testHome, { recursive: true });
    await Bun.write(
      join(testHome, "config.json"),
      JSON.stringify({
        version: "0.4.0",
        reasoning: { enabled: true },
        permissions: { managed: true },
        providers: { claude: { enabled: false }, opencode: { enabled: false } },
        assistant: { name: "Shaka" },
        principal: { name: "Test" },
        commands: { disabled: [] },
      }),
    );
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  test("addToDisabledList adds names to commands.disabled in config", async () => {
    const { addToDisabledList } = await import("../../../src/commands/commands");

    await addToDisabledList(testHome, ["foo", "bar"]);

    const config = await Bun.file(join(testHome, "config.json")).json();
    expect(config.commands.disabled).toContain("foo");
    expect(config.commands.disabled).toContain("bar");
  });

  test("addToDisabledList deduplicates existing entries", async () => {
    const { addToDisabledList } = await import("../../../src/commands/commands");

    await addToDisabledList(testHome, ["foo"]);
    await addToDisabledList(testHome, ["foo", "bar"]);

    const config = await Bun.file(join(testHome, "config.json")).json();
    expect(config.commands.disabled).toEqual(["foo", "bar"]);
  });

  test("removeFromDisabledList removes names from commands.disabled in config", async () => {
    const { addToDisabledList, removeFromDisabledList } = await import(
      "../../../src/commands/commands"
    );

    await addToDisabledList(testHome, ["foo", "bar", "baz"]);
    await removeFromDisabledList(testHome, ["bar"]);

    const config = await Bun.file(join(testHome, "config.json")).json();
    expect(config.commands.disabled).toEqual(["foo", "baz"]);
  });
});
