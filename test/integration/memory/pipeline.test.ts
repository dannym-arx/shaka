import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { searchMemory } from "../../../src/memory/search";
import {
  listSummaries,
  loadSummary,
  selectRecentSummaries,
  writeSummary,
} from "../../../src/memory/storage";
import { buildSummarizationPrompt, parseSummaryOutput } from "../../../src/memory/summarize";
import {
  parseClaudeCodeTranscript,
  parseOpencodeTranscript,
  truncateTranscript,
} from "../../../src/memory/transcript";
import {
  CLAUDE_JSONL,
  CLAUDE_LLM_OUTPUT,
  CLAUDE_METADATA,
  OPENCODE_EXPORT,
  OPENCODE_LLM_OUTPUT,
  OPENCODE_METADATA,
} from "./fixtures";

const testMemoryDir = "/tmp/shaka-test-pipeline";

describe("Memory pipeline", () => {
  beforeEach(async () => {
    await rm(testMemoryDir, { recursive: true, force: true });
    await mkdir(testMemoryDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testMemoryDir, { recursive: true, force: true });
  });

  describe("Claude Code pipeline", () => {
    test("parses JSONL transcript into normalized messages", () => {
      const messages = parseClaudeCodeTranscript(CLAUDE_JSONL);

      expect(messages).toHaveLength(6);
      expect(messages[0]?.role).toBe("user");
      expect(messages[0]?.content).toContain("rate limiting");
      expect(messages[1]?.role).toBe("assistant");
      expect(messages[1]?.content).toContain("[Tool: Read]");
    });

    test("composes full cycle from transcript to searchable summary", async () => {
      const messages = parseClaudeCodeTranscript(CLAUDE_JSONL);
      const truncated = truncateTranscript(messages, 100_000);
      expect(truncated).toEqual(messages);

      const prompt = buildSummarizationPrompt(truncated, CLAUDE_METADATA);
      expect(prompt).toContain("rate limiting");
      expect(prompt).toContain("/projects/api-server");

      const parsed = parseSummaryOutput(CLAUDE_LLM_OUTPUT);
      expect(parsed).not.toBeNull();

      const summary = { ...parsed!, metadata: CLAUDE_METADATA };
      const filePath = await writeSummary(testMemoryDir, summary);
      expect(await Bun.file(filePath).exists()).toBe(true);

      const listed = await listSummaries(testMemoryDir);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.title).toContain("Rate Limiting");
      expect(listed[0]?.provider).toBe("claude");
      expect(listed[0]?.cwd).toBe("/projects/api-server");
      expect(listed[0]?.sessionId).toBe("ses-claude-fixture");

      const results = await searchMemory("redis", testMemoryDir);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.title).toContain("Rate Limiting");

      const loaded = await loadSummary(filePath);
      expect(loaded?.metadata.provider).toBe("claude");
      expect(loaded?.metadata.sessionId).toBe("ses-claude-fixture");
    });
  });

  describe("opencode pipeline", () => {
    test("parses export JSON into normalized messages", () => {
      const messages = parseOpencodeTranscript(OPENCODE_EXPORT);

      expect(messages).toHaveLength(4);
      expect(messages[0]?.role).toBe("user");
      expect(messages[0]?.content).toContain("CSS grid");
      expect(messages[1]?.role).toBe("assistant");
      expect(messages[1]?.content).toContain("[Tool: Read]");
    });

    test("composes full cycle from transcript to searchable summary", async () => {
      const messages = parseOpencodeTranscript(OPENCODE_EXPORT);
      const truncated = truncateTranscript(messages, 100_000);
      expect(truncated).toEqual(messages);

      const prompt = buildSummarizationPrompt(truncated, OPENCODE_METADATA);
      expect(prompt).toContain("CSS grid");
      expect(prompt).toContain("/projects/dashboard");

      const parsed = parseSummaryOutput(OPENCODE_LLM_OUTPUT);
      expect(parsed).not.toBeNull();

      const summary = { ...parsed!, metadata: OPENCODE_METADATA };
      const filePath = await writeSummary(testMemoryDir, summary);
      expect(await Bun.file(filePath).exists()).toBe(true);

      const listed = await listSummaries(testMemoryDir);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.provider).toBe("opencode");
      expect(listed[0]?.cwd).toBe("/projects/dashboard");

      const results = await searchMemory("grid", testMemoryDir);
      expect(results.length).toBeGreaterThan(0);

      const loaded = await loadSummary(filePath);
      expect(loaded?.metadata.provider).toBe("opencode");
    });
  });

  describe("cross-provider", () => {
    test("selectRecentSummaries prefers CWD matches", async () => {
      const claudeParsed = parseSummaryOutput(CLAUDE_LLM_OUTPUT)!;
      await writeSummary(testMemoryDir, { ...claudeParsed, metadata: CLAUDE_METADATA });

      const opencodeParsed = parseSummaryOutput(OPENCODE_LLM_OUTPUT)!;
      await writeSummary(testMemoryDir, { ...opencodeParsed, metadata: OPENCODE_METADATA });

      const all = await listSummaries(testMemoryDir);
      expect(all).toHaveLength(2);

      const selected = selectRecentSummaries(all, "/projects/dashboard", 1);
      expect(selected).toHaveLength(1);
      expect(selected[0]?.provider).toBe("opencode");
      expect(selected[0]?.cwd).toBe("/projects/dashboard");
    });

    test("search finds summaries from each provider independently", async () => {
      const claudeParsed = parseSummaryOutput(CLAUDE_LLM_OUTPUT)!;
      await writeSummary(testMemoryDir, { ...claudeParsed, metadata: CLAUDE_METADATA });

      const opencodeParsed = parseSummaryOutput(OPENCODE_LLM_OUTPUT)!;
      await writeSummary(testMemoryDir, { ...opencodeParsed, metadata: OPENCODE_METADATA });

      const claudeResults = await searchMemory("rate limiter", testMemoryDir);
      expect(claudeResults).toHaveLength(1);
      expect(claudeResults[0]?.title).toContain("Rate Limiting");

      const opencodeResults = await searchMemory("sidebar", testMemoryDir);
      expect(opencodeResults).toHaveLength(1);
      expect(opencodeResults[0]?.title).toContain("Dashboard Layout");
    });
  });

  describe("truncation", () => {
    test("truncated transcript produces valid prompt", () => {
      const messages = parseClaudeCodeTranscript(CLAUDE_JSONL);
      const truncated = truncateTranscript(messages, 200);

      expect(truncated.length).toBeLessThan(messages.length);
      expect(truncated[0]?.content).toContain("truncated");

      const prompt = buildSummarizationPrompt(truncated, CLAUDE_METADATA);
      expect(prompt).toContain("<transcript>");
      expect(prompt).toContain("truncated");
    });
  });

  describe("inference failure", () => {
    test("parseSummaryOutput returns null for garbage input", () => {
      expect(parseSummaryOutput("just some random text")).toBeNull();
      expect(parseSummaryOutput("")).toBeNull();
      expect(parseSummaryOutput("---\ninvalid yaml: [\n---\n")).toBeNull();
    });

    test("parseSummaryOutput returns null for valid frontmatter without title", () => {
      const noTitle = `---
date: 2026-02-09
cwd: /projects/test
tags: [test]
provider: claude
session_id: ses-test
---

Some content without a heading.`;
      expect(parseSummaryOutput(noTitle)).toBeNull();
    });
  });

  describe("re-summarization", () => {
    test("same session ID overwrites previous summary", async () => {
      const parsed = parseSummaryOutput(OPENCODE_LLM_OUTPUT)!;

      const path1 = await writeSummary(testMemoryDir, {
        ...parsed,
        metadata: OPENCODE_METADATA,
        title: "Initial partial summary",
      });
      const path2 = await writeSummary(testMemoryDir, {
        ...parsed,
        metadata: OPENCODE_METADATA,
      });

      expect(path1).toBe(path2);

      const listed = await listSummaries(testMemoryDir);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.title).toBe(parsed.title);

      const results = await searchMemory("Dashboard", testMemoryDir);
      expect(results).toHaveLength(1);
    });
  });
});
