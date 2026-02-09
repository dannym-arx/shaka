import { describe, expect, test } from "bun:test";
import {
  type SessionEndEvent,
  type SessionStartEvent,
  type ToolAfterEvent,
  createSessionEndEvent,
  createSessionStartEvent,
  createToolAfterEvent,
  isSessionEndEvent,
  isSessionStartEvent,
  isToolAfterEvent,
} from "../../../src/domain/events";

describe("Events", () => {
  describe("createSessionStartEvent", () => {
    test("creates event with required fields", () => {
      const event = createSessionStartEvent({
        sessionId: "test-123",
        cwd: "/projects/myapp",
      });

      expect(event.type).toBe("session.start");
      expect(event.sessionId).toBe("test-123");
      expect(event.cwd).toBe("/projects/myapp");
      expect(event.source).toBe("startup");
      expect(typeof event.timestamp).toBe("number");
    });

    test("accepts optional source", () => {
      const event = createSessionStartEvent({
        sessionId: "test-123",
        cwd: "/projects/myapp",
        source: "resume",
      });

      expect(event.source).toBe("resume");
    });

    test("accepts optional model", () => {
      const event = createSessionStartEvent({
        sessionId: "test-123",
        cwd: "/projects/myapp",
        model: "claude-3-opus",
      });

      expect(event.model).toBe("claude-3-opus");
    });

    test("timestamp is recent", () => {
      const before = Date.now();
      const event = createSessionStartEvent({
        sessionId: "test-123",
        cwd: "/projects/myapp",
      });
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("isSessionStartEvent", () => {
    test("returns true for valid event", () => {
      const event: SessionStartEvent = {
        type: "session.start",
        sessionId: "test",
        cwd: "/",
        timestamp: Date.now(),
        source: "startup",
      };

      expect(isSessionStartEvent(event)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isSessionStartEvent(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isSessionStartEvent(undefined)).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(isSessionStartEvent({})).toBe(false);
    });

    test("returns false for wrong event type", () => {
      expect(isSessionStartEvent({ type: "other" })).toBe(false);
    });
  });

  describe("createSessionEndEvent", () => {
    test("creates event with required fields", () => {
      const event = createSessionEndEvent({
        sessionId: "test-456",
        cwd: "/projects/myapp",
        reason: "prompt_input_exit",
      });

      expect(event.type).toBe("session.end");
      expect(event.sessionId).toBe("test-456");
      expect(event.cwd).toBe("/projects/myapp");
      expect(event.reason).toBe("prompt_input_exit");
      expect(typeof event.timestamp).toBe("number");
    });

    test("accepts optional transcriptPath", () => {
      const event = createSessionEndEvent({
        sessionId: "test-456",
        cwd: "/projects/myapp",
        reason: "prompt_input_exit",
        transcriptPath: "/tmp/transcript.jsonl",
      });

      expect(event.transcriptPath).toBe("/tmp/transcript.jsonl");
    });

    test("omits transcriptPath when not provided", () => {
      const event = createSessionEndEvent({
        sessionId: "test-456",
        cwd: "/projects/myapp",
        reason: "idle",
      });

      expect(event.transcriptPath).toBeUndefined();
    });

    test("timestamp is recent", () => {
      const before = Date.now();
      const event = createSessionEndEvent({
        sessionId: "test-456",
        cwd: "/projects/myapp",
        reason: "idle",
      });
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    test("passes through arbitrary reason strings", () => {
      const event = createSessionEndEvent({
        sessionId: "test-456",
        cwd: "/projects/myapp",
        reason: "some_future_reason",
      });

      expect(event.reason).toBe("some_future_reason");
    });
  });

  describe("isSessionEndEvent", () => {
    test("returns true for valid event", () => {
      const event: SessionEndEvent = {
        type: "session.end",
        sessionId: "test",
        cwd: "/",
        timestamp: Date.now(),
        reason: "idle",
      };

      expect(isSessionEndEvent(event)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isSessionEndEvent(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isSessionEndEvent(undefined)).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(isSessionEndEvent({})).toBe(false);
    });

    test("returns false for wrong event type", () => {
      expect(isSessionEndEvent({ type: "session.start" })).toBe(false);
    });
  });

  describe("createToolAfterEvent", () => {
    test("creates event with required fields", () => {
      const event = createToolAfterEvent({
        sessionId: "test-789",
        cwd: "/projects/myapp",
        toolName: "Bash",
        toolInput: { command: "git status" },
        toolUseId: "tool_abc123",
      });

      expect(event.type).toBe("tool.after");
      expect(event.sessionId).toBe("test-789");
      expect(event.cwd).toBe("/projects/myapp");
      expect(event.toolName).toBe("Bash");
      expect(event.toolInput).toEqual({ command: "git status" });
      expect(event.toolUseId).toBe("tool_abc123");
      expect(typeof event.timestamp).toBe("number");
    });

    test("timestamp is recent", () => {
      const before = Date.now();
      const event = createToolAfterEvent({
        sessionId: "test-789",
        cwd: "/projects/myapp",
        toolName: "Read",
        toolInput: { filePath: "/src/index.ts" },
        toolUseId: "tool_def456",
      });
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    test("preserves complex toolInput", () => {
      const input = {
        filePath: "/src/index.ts",
        offset: 0,
        limit: 100,
        nested: { key: "value" },
      };
      const event = createToolAfterEvent({
        sessionId: "test-789",
        cwd: "/projects/myapp",
        toolName: "Read",
        toolInput: input,
        toolUseId: "tool_ghi789",
      });

      expect(event.toolInput).toEqual(input);
    });
  });

  describe("isToolAfterEvent", () => {
    test("returns true for valid event", () => {
      const event: ToolAfterEvent = {
        type: "tool.after",
        sessionId: "test",
        cwd: "/",
        timestamp: Date.now(),
        toolName: "Bash",
        toolInput: {},
        toolUseId: "tool_123",
      };

      expect(isToolAfterEvent(event)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isToolAfterEvent(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isToolAfterEvent(undefined)).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(isToolAfterEvent({})).toBe(false);
    });

    test("returns false for wrong event type", () => {
      expect(isToolAfterEvent({ type: "session.start" })).toBe(false);
    });
  });
});
