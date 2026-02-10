import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { getPath, parseValue, setPath } from "../../../src/commands/config";

describe("config command utilities", () => {
  describe("getPath", () => {
    test("gets top-level value", () => {
      const obj = { name: "test" };
      expect(getPath(obj, "name")).toBe("test");
    });

    test("gets nested value", () => {
      const obj = { a: { b: { c: "deep" } } };
      expect(getPath(obj, "a.b.c")).toBe("deep");
    });

    test("returns undefined for non-existent key", () => {
      const obj = { a: 1 };
      expect(getPath(obj, "b")).toBeUndefined();
    });

    test("returns undefined for non-existent nested key", () => {
      const obj = { a: { b: 1 } };
      expect(getPath(obj, "a.b.c")).toBeUndefined();
    });

    test("returns undefined when traversing through primitive", () => {
      const obj = { a: "string" };
      expect(getPath(obj, "a.b")).toBeUndefined();
    });

    test("returns undefined when traversing through null", () => {
      const obj = { a: null };
      expect(getPath(obj, "a.b")).toBeUndefined();
    });

    test("gets object value", () => {
      const obj = { a: { b: { nested: true } } };
      expect(getPath(obj, "a.b")).toEqual({ nested: true });
    });

    test("gets array value", () => {
      const obj = { items: [1, 2, 3] };
      expect(getPath(obj, "items")).toEqual([1, 2, 3]);
    });

    test("gets boolean values", () => {
      const obj = { enabled: true, disabled: false };
      expect(getPath(obj, "enabled")).toBe(true);
      expect(getPath(obj, "disabled")).toBe(false);
    });

    test("gets number values including zero", () => {
      const obj = { count: 0, value: 42 };
      expect(getPath(obj, "count")).toBe(0);
      expect(getPath(obj, "value")).toBe(42);
    });
  });

  describe("setPath", () => {
    test("sets top-level value", () => {
      const obj: Record<string, unknown> = {};
      const result = setPath(obj, "name", "test");
      expect(result.ok).toBe(true);
      expect(obj.name).toBe("test");
    });

    test("sets nested value creating intermediate objects", () => {
      const obj: Record<string, unknown> = {};
      const result = setPath(obj, "a.b.c", "deep");
      expect(result.ok).toBe(true);
      expect(obj).toEqual({ a: { b: { c: "deep" } } });
    });

    test("sets value in existing nested structure", () => {
      const obj: Record<string, unknown> = { a: { b: { existing: 1 } } };
      const result = setPath(obj, "a.b.c", "new");
      expect(result.ok).toBe(true);
      expect(obj).toEqual({ a: { b: { existing: 1, c: "new" } } });
    });

    test("overwrites primitive with primitive", () => {
      const obj: Record<string, unknown> = { a: "old" };
      const result = setPath(obj, "a", "new");
      expect(result.ok).toBe(true);
      expect(obj.a).toBe("new");
    });

    test("prevents overwriting object with primitive", () => {
      const obj: Record<string, unknown> = {
        providers: { claude: { enabled: true, model: "sonnet" } },
      };
      const result = setPath(obj, "providers.claude", "bad");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("would overwrite an object");
        expect(result.error).toContain("2 keys");
      }
      // Original value preserved
      expect(obj.providers).toEqual({ claude: { enabled: true, model: "sonnet" } });
    });

    test("allows overwriting empty object with primitive", () => {
      const obj: Record<string, unknown> = { empty: {} };
      const result = setPath(obj, "empty", "value");
      expect(result.ok).toBe(true);
      expect(obj.empty).toBe("value");
    });

    test("errors when traversing through primitive", () => {
      const obj: Record<string, unknown> = { a: "string" };
      const result = setPath(obj, "a.b.c", "value");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('"a" is not an object');
      }
    });

    test("errors when traversing through array", () => {
      const obj: Record<string, unknown> = { items: [1, 2, 3] };
      const result = setPath(obj, "items.nested", "value");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('"items" is not an object');
      }
    });

    test("replaces null with intermediate object", () => {
      const obj: Record<string, unknown> = { a: null };
      const result = setPath(obj, "a.b", "value");
      expect(result.ok).toBe(true);
      expect(obj).toEqual({ a: { b: "value" } });
    });

    test("allows setting object value", () => {
      const obj: Record<string, unknown> = {};
      const result = setPath(obj, "config", { nested: true });
      expect(result.ok).toBe(true);
      expect(obj.config).toEqual({ nested: true });
    });

    test("allows overwriting object with object", () => {
      const obj: Record<string, unknown> = { config: { old: true } };
      const result = setPath(obj, "config", { new: true });
      expect(result.ok).toBe(true);
      expect(obj.config).toEqual({ new: true });
    });
  });

  describe("parseValue", () => {
    test("parses 'true' as boolean", () => {
      expect(parseValue("true")).toBe(true);
    });

    test("parses 'false' as boolean", () => {
      expect(parseValue("false")).toBe(false);
    });

    test("parses integer as number", () => {
      expect(parseValue("42")).toBe(42);
    });

    test("parses negative integer as number", () => {
      expect(parseValue("-5")).toBe(-5);
    });

    test("parses decimal as number", () => {
      expect(parseValue("3.14")).toBe(3.14);
    });

    test("parses zero as number", () => {
      expect(parseValue("0")).toBe(0);
    });

    test("keeps model string as string", () => {
      expect(parseValue("openrouter/anthropic/claude-haiku-4.5")).toBe(
        "openrouter/anthropic/claude-haiku-4.5",
      );
    });

    test("keeps string with numbers as string", () => {
      expect(parseValue("claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
    });

    test("keeps empty string as string", () => {
      expect(parseValue("")).toBe("");
    });

    test("keeps whitespace-only string as string", () => {
      expect(parseValue("   ")).toBe("   ");
    });

    test("does not parse hex strings as numbers", () => {
      expect(parseValue("0x10")).toBe("0x10");
    });

    test("does not parse octal strings as numbers", () => {
      expect(parseValue("0o77")).toBe("0o77");
    });

    test("does not parse scientific notation", () => {
      expect(parseValue("1e10")).toBe("1e10");
    });

    test("keeps path-like strings as strings", () => {
      expect(parseValue("/home/user/.config")).toBe("/home/user/.config");
    });

    test("parses 'TRUE' as string (case sensitive)", () => {
      expect(parseValue("TRUE")).toBe("TRUE");
    });

    test("parses 'True' as string (case sensitive)", () => {
      expect(parseValue("True")).toBe("True");
    });
  });
});

describe("config command integration", () => {
  const testShakaHome = "/tmp/shaka-test-config-cmd";

  beforeEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
    await mkdir(testShakaHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(testShakaHome, { recursive: true, force: true });
  });

  test("get retrieves nested value", async () => {
    const config = {
      version: "1.0.0",
      providers: { opencode: { enabled: true, summarization_model: "auto" } },
    };
    await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(config));

    const configData = (await Bun.file(`${testShakaHome}/config.json`).json()) as Record<
      string,
      unknown
    >;
    const value = getPath(configData, "providers.opencode.summarization_model");
    expect(value).toBe("auto");
  });

  test("set updates nested value", async () => {
    const config = {
      version: "1.0.0",
      providers: { opencode: { enabled: true, summarization_model: "auto" } },
    };
    await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(config));

    const configData = (await Bun.file(`${testShakaHome}/config.json`).json()) as Record<
      string,
      unknown
    >;
    const result = setPath(
      configData,
      "providers.opencode.summarization_model",
      "openrouter/anthropic/claude-haiku-4.5",
    );
    expect(result.ok).toBe(true);

    await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(configData, null, 2));

    const updated = (await Bun.file(`${testShakaHome}/config.json`).json()) as Record<
      string,
      unknown
    >;
    expect(getPath(updated, "providers.opencode.summarization_model")).toBe(
      "openrouter/anthropic/claude-haiku-4.5",
    );
  });

  test("set preserves other config values", async () => {
    const config = {
      version: "1.0.0",
      reasoning: { enabled: true },
      providers: { opencode: { enabled: true } },
    };
    await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(config));

    const configData = (await Bun.file(`${testShakaHome}/config.json`).json()) as Record<
      string,
      unknown
    >;
    setPath(configData, "providers.opencode.summarization_model", "haiku");
    await Bun.write(`${testShakaHome}/config.json`, JSON.stringify(configData, null, 2));

    const updated = (await Bun.file(`${testShakaHome}/config.json`).json()) as Record<
      string,
      unknown
    >;
    expect(getPath(updated, "version")).toBe("1.0.0");
    expect(getPath(updated, "reasoning.enabled")).toBe(true);
    expect(getPath(updated, "providers.opencode.enabled")).toBe(true);
  });
});
