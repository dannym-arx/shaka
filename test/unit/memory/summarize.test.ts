import { describe, expect, test } from "bun:test";
import {
  type SessionMetadata,
  type SessionSummary,
  buildSummarizationPrompt,
  parseSummaryOutput,
} from "../../../src/memory/summarize";
import type { NormalizedMessage } from "../../../src/memory/transcript";

const sampleMetadata: SessionMetadata = {
  date: "2026-02-09",
  cwd: "/projects/myapp",
  provider: "claude",
  sessionId: "ses-abc123",
};

const sampleMessages: NormalizedMessage[] = [
  { role: "user", content: "Fix the auth bug in login.ts" },
  {
    role: "assistant",
    content: "I found the issue. The token validation was skipping expiry checks.\n[Tool: Edit]",
  },
  { role: "user", content: "Run the tests" },
  { role: "assistant", content: "All 42 tests pass.\n[Tool: Bash]" },
];

/** A realistic LLM summary output with proper frontmatter */
const validSummaryOutput = `---
date: "2026-02-09"
cwd: /projects/myapp
tags: [auth, bug-fix, testing]
provider: claude
session_id: ses-abc123
---

# Fix auth token expiry validation

## Summary
Fixed a bug in login.ts where token validation was skipping expiry checks. All 42 tests pass after the fix.

## Decisions
- Used strict expiry comparison instead of lenient check

## Files Modified
- src/auth/login.ts

## Problems Solved
- Token expiry validation was being skipped, allowing expired tokens

## Open Questions
- Should we add refresh token support?
`;

describe("Summarize", () => {
  describe("buildSummarizationPrompt", () => {
    test("includes transcript messages in output", () => {
      const prompt = buildSummarizationPrompt(sampleMessages, sampleMetadata);
      expect(prompt).toContain("Fix the auth bug in login.ts");
      expect(prompt).toContain("token validation was skipping expiry checks");
      expect(prompt).toContain("[Tool: Bash]");
    });

    test("includes metadata in template", () => {
      const prompt = buildSummarizationPrompt(sampleMessages, sampleMetadata);
      expect(prompt).toContain("2026-02-09");
      expect(prompt).toContain("/projects/myapp");
      expect(prompt).toContain("claude");
      expect(prompt).toContain("ses-abc123");
    });

    test("includes message roles", () => {
      const prompt = buildSummarizationPrompt(sampleMessages, sampleMetadata);
      expect(prompt).toContain("user:");
      expect(prompt).toContain("assistant:");
    });

    test("asks for YAML frontmatter in output format", () => {
      const prompt = buildSummarizationPrompt(sampleMessages, sampleMetadata);
      expect(prompt).toContain("---");
      expect(prompt).toContain("tags:");
    });

    test("handles empty messages array", () => {
      const prompt = buildSummarizationPrompt([], sampleMetadata);
      expect(prompt).toContain("2026-02-09");
      // Should still produce a valid prompt, just with empty transcript
    });

    test("works with opencode provider", () => {
      const metadata: SessionMetadata = { ...sampleMetadata, provider: "opencode" };
      const prompt = buildSummarizationPrompt(sampleMessages, metadata);
      expect(prompt).toContain("opencode");
    });
  });

  describe("parseSummaryOutput", () => {
    test("parses valid summary with all sections", () => {
      const result = parseSummaryOutput(validSummaryOutput);
      expect(result).not.toBeNull();
      expect(result?.metadata.date).toBe("2026-02-09");
      expect(result?.metadata.cwd).toBe("/projects/myapp");
      expect(result?.metadata.provider).toBe("claude");
      expect(result?.metadata.sessionId).toBe("ses-abc123");
      expect(result?.tags).toEqual(["auth", "bug-fix", "testing"]);
      expect(result?.title).toBe("Fix auth token expiry validation");
    });

    test("body contains the markdown content after the title", () => {
      const result = parseSummaryOutput(validSummaryOutput);
      expect(result).not.toBeNull();
      expect(result?.body).toContain("## Summary");
      expect(result?.body).toContain("## Decisions");
      expect(result?.body).toContain("## Files Modified");
      expect(result?.body).toContain("## Problems Solved");
      expect(result?.body).toContain("## Open Questions");
    });

    test("body does not include the title heading", () => {
      const result = parseSummaryOutput(validSummaryOutput);
      expect(result).not.toBeNull();
      expect(result?.body).not.toContain("# Fix auth token expiry validation");
    });

    test("returns null for empty input", () => {
      expect(parseSummaryOutput("")).toBeNull();
    });

    test("returns null for input without frontmatter", () => {
      expect(parseSummaryOutput("Just some text without frontmatter")).toBeNull();
    });

    test("returns null for input with invalid frontmatter", () => {
      const bad = `---
not: [valid: yaml: {{
---
# Title
Body text`;
      expect(parseSummaryOutput(bad)).toBeNull();
    });

    test("returns null when required frontmatter fields are missing", () => {
      const missingFields = `---
tags: [test]
---
# Title
Body`;
      expect(parseSummaryOutput(missingFields)).toBeNull();
    });

    test("tolerates missing optional body sections", () => {
      const minimal = `---
date: "2026-02-09"
cwd: /projects/myapp
tags: [test]
provider: claude
session_id: ses-abc123
---

# Minimal session

## Summary
Did some work.
`;
      const result = parseSummaryOutput(minimal);
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Minimal session");
      expect(result?.body).toContain("## Summary");
    });

    test("handles tags as empty array", () => {
      const noTags = `---
date: "2026-02-09"
cwd: /projects/myapp
tags: []
provider: opencode
session_id: ses-xyz789
---

# Session with no tags

## Summary
Quick session.
`;
      const result = parseSummaryOutput(noTags);
      expect(result).not.toBeNull();
      expect(result?.tags).toEqual([]);
    });

    test("handles frontmatter with extra whitespace", () => {
      const extraSpace = `---
date:   "2026-02-09"
cwd:    /projects/myapp
tags:   [test, spaces]
provider:  claude
session_id:  ses-abc123
---

# Spaced out

## Summary
Works with extra spaces.
`;
      const result = parseSummaryOutput(extraSpace);
      expect(result).not.toBeNull();
      expect(result?.metadata.date).toBe("2026-02-09");
      expect(result?.tags).toEqual(["test", "spaces"]);
    });

    test("handles frontmatter where date is not quoted", () => {
      const unquotedDate = `---
date: 2026-02-09
cwd: /projects/myapp
tags: [test]
provider: claude
session_id: ses-abc123
---

# Unquoted date

## Summary
Date without quotes.
`;
      const result = parseSummaryOutput(unquotedDate);
      expect(result).not.toBeNull();
      expect(result?.metadata.date).toBe("2026-02-09");
    });

    test("returns null when title heading is missing", () => {
      const noTitle = `---
date: "2026-02-09"
cwd: /projects/myapp
tags: [test]
provider: claude
session_id: ses-abc123
---

Just body text without a heading.
`;
      expect(parseSummaryOutput(noTitle)).toBeNull();
    });
  });
});
