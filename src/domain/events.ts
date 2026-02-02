/**
 * Event type definitions for Shaka hooks.
 */

export type SessionStartSource = "startup" | "resume" | "clear" | "compact";

export interface SessionStartEvent {
  readonly type: "session.start";
  readonly sessionId: string;
  readonly cwd: string;
  readonly timestamp: number;
  readonly source: SessionStartSource;
  readonly model?: string;
}

export interface SessionStartEventInput {
  sessionId: string;
  cwd: string;
  source?: SessionStartSource;
  model?: string;
}

export function createSessionStartEvent(input: SessionStartEventInput): SessionStartEvent {
  return {
    type: "session.start",
    sessionId: input.sessionId,
    cwd: input.cwd,
    timestamp: Date.now(),
    source: input.source ?? "startup",
    model: input.model,
  };
}

export function isSessionStartEvent(event: unknown): event is SessionStartEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as SessionStartEvent).type === "session.start"
  );
}

/**
 * Result returned by event handlers.
 */
export interface HandlerResult {
  readonly additionalContext?: string;
  readonly error?: string;
}
