import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "../../../src/domain/frontmatter";

describe("parseFrontmatter", () => {
  test("parses valid frontmatter and body", () => {
    const result = parseFrontmatter("---\ntitle: Hello\n---\nBody content");
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ title: "Hello" });
    expect(result!.body).toBe("Body content");
  });

  test("returns null for missing frontmatter", () => {
    expect(parseFrontmatter("Just some text")).toBeNull();
  });

  test("returns null for invalid YAML", () => {
    expect(parseFrontmatter("---\n: invalid: yaml: [[\n---\nBody")).toBeNull();
  });

  test("handles empty body", () => {
    const result = parseFrontmatter("---\nkey: value\n---\n");
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ key: "value" });
    expect(result!.body).toBe("");
  });

  test("handles frontmatter-only (no body)", () => {
    const result = parseFrontmatter("---\nkey: value\n---");
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ key: "value" });
    expect(result!.body).toBe("");
  });

  test("preserves extra --- in body content", () => {
    const result = parseFrontmatter("---\nkey: value\n---\nBody with --- separator");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("Body with --- separator");
  });

  test("strips BOM prefix", () => {
    const result = parseFrontmatter("\uFEFF---\nkey: value\n---\nBody");
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ key: "value" });
  });

  test("normalizes CRLF line endings", () => {
    const result = parseFrontmatter("---\r\nkey: value\r\n---\r\nBody");
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ key: "value" });
    expect(result!.body).toBe("Body");
  });

  test("returns null for empty frontmatter block", () => {
    expect(parseFrontmatter("---\n\n---\nBody")).toBeNull();
  });

  test("returns null for non-object YAML (plain string)", () => {
    expect(parseFrontmatter("---\njust a string\n---\nBody")).toBeNull();
  });

  test("parses complex YAML values", () => {
    const input = `---
description: A test command
cwd:
  - ~/Projects/a
  - ~/Projects/b
subtask: true
---
Body here`;
    const result = parseFrontmatter(input);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.description).toBe("A test command");
    expect(result!.frontmatter.cwd).toEqual(["~/Projects/a", "~/Projects/b"]);
    expect(result!.frontmatter.subtask).toBe(true);
  });
});
