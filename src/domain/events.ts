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

// --- SessionEndEvent ---

export interface SessionEndEvent {
  readonly type: "session.end";
  readonly sessionId: string;
  readonly cwd: string;
  readonly timestamp: number;
  readonly reason: string;
  readonly transcriptPath?: string;
}

export interface SessionEndEventInput {
  sessionId: string;
  cwd: string;
  reason: string;
  transcriptPath?: string;
}

export function createSessionEndEvent(input: SessionEndEventInput): SessionEndEvent {
  return {
    type: "session.end",
    sessionId: input.sessionId,
    cwd: input.cwd,
    timestamp: Date.now(),
    reason: input.reason,
    transcriptPath: input.transcriptPath,
  };
}

export function isSessionEndEvent(event: unknown): event is SessionEndEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as SessionEndEvent).type === "session.end"
  );
}

// --- ToolAfterEvent ---

export interface ToolAfterEvent {
  readonly type: "tool.after";
  readonly sessionId: string;
  readonly cwd: string;
  readonly timestamp: number;
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly toolUseId: string;
}

export interface ToolAfterEventInput {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export function createToolAfterEvent(input: ToolAfterEventInput): ToolAfterEvent {
  return {
    type: "tool.after",
    sessionId: input.sessionId,
    cwd: input.cwd,
    timestamp: Date.now(),
    toolName: input.toolName,
    toolInput: input.toolInput,
    toolUseId: input.toolUseId,
  };
}

export function isToolAfterEvent(event: unknown): event is ToolAfterEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as ToolAfterEvent).type === "tool.after"
  );
}

/**
 * Result returned by event handlers.
 */
export interface HandlerResult {
  readonly additionalContext?: string;
  readonly error?: string;
}
