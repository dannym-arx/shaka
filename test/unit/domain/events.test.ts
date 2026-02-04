import { describe, expect, test } from "bun:test";
import {
  type SessionStartEvent,
  createSessionStartEvent,
  isSessionStartEvent,
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
});
