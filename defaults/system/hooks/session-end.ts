#!/usr/bin/env bun
/**
 * SessionEnd hook — transcript summarization
 *
 * Fires when a coding session ends. Reads the transcript, calls inference
 * to summarize it, and writes a summary file to memory/sessions/.
 *
 * Provider detection:
 * - Claude Code sends { transcript_path, session_id, reason, cwd }
 * - opencode sends { session_id, reason, cwd } (no transcript_path)
 *
 * Fail-open: any error logs to stderr and exits 0.
 */

import {
  type NormalizedMessage,
  type SessionMetadata,
  buildSummarizationPrompt,
  inference,
  isSubagent,
  parseClaudeCodeTranscript,
  parseOpencodeTranscript,
  parseSummaryOutput,
  resolveShakaHome,
  truncateTranscript,
  writeSummary,
} from "shaka";

/** Hook trigger events — Shaka canonical names */
export const TRIGGER = ["session.end"] as const;
export const HOOK_VERSION = "0.1.0";

/** Max transcript chars to send to inference (avoid token limits) */
const MAX_TRANSCRIPT_CHARS = 100_000;

interface SessionEndInput {
  session_id?: string;
  transcript_path?: string;
  reason?: string;
  cwd?: string;
}

/**
 * Read stdin with timeout. Session-end hooks receive JSON on stdin.
 */
async function readStdin(timeout = 3000): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), timeout);
    process.stdin.on("data", (chunk) => {
      data += chunk.toString();
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

/**
 * Read and parse transcript based on provider.
 * Claude Code: read transcript_path directly from disk.
 * opencode: spawn `opencode export <sessionId>` to get transcript.
 */
async function loadTranscript(input: SessionEndInput): Promise<NormalizedMessage[]> {
  if (typeof input.transcript_path === "string") {
    return await loadClaudeTranscript(input.transcript_path);
  }
  return await loadOpencodeTranscript(input.session_id);
}

async function loadClaudeTranscript(transcriptPath: string): Promise<NormalizedMessage[]> {
  const content = await Bun.file(transcriptPath).text();
  return parseClaudeCodeTranscript(content);
}

async function loadOpencodeTranscript(sessionId: string | undefined): Promise<NormalizedMessage[]> {
  if (!sessionId) return [];

  const result = await Bun.$`opencode export ${sessionId}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(`opencode export failed (exit ${result.exitCode})`);
    return [];
  }

  return parseOpencodeTranscript(result.stdout.toString());
}

/**
 * Save raw inference output to failed/ directory for debugging.
 */
async function saveFailedOutput(
  memoryDir: string,
  sessionId: string,
  rawOutput: string,
): Promise<void> {
  const failedDir = `${memoryDir}/sessions/failed`;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(failedDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${sessionId.slice(0, 8)}.txt`;
  await Bun.write(`${failedDir}/${filename}`, rawOutput);
  console.error(`Saved raw output to ${failedDir}/${filename}`);
}

async function main() {
  // Skip for subagent sessions
  if (isSubagent()) {
    process.exit(0);
  }

  const rawInput = await readStdin();
  if (!rawInput) {
    console.error("No input received");
    process.exit(0);
  }

  let input: SessionEndInput;
  try {
    input = JSON.parse(rawInput);
  } catch {
    console.error("Failed to parse stdin JSON");
    process.exit(0);
  }

  const sessionId = input.session_id ?? "unknown";
  const cwd = input.cwd ?? process.cwd();
  const isClaudeCode = "transcript_path" in input && typeof input.transcript_path === "string";
  const provider = isClaudeCode ? "claude" : "opencode";

  console.error(`Session end: ${provider} session ${sessionId}`);

  // Load and parse transcript
  const messages = await loadTranscript(input);
  if (messages.length === 0) {
    console.error("Empty transcript, skipping summarization");
    process.exit(0);
  }

  // Truncate if needed
  const truncated = truncateTranscript(messages, MAX_TRANSCRIPT_CHARS);

  // Build metadata
  const metadata: SessionMetadata = {
    date: new Date().toISOString().split("T")[0] ?? new Date().toISOString(),
    cwd,
    provider,
    sessionId,
  };

  // Build prompt and call inference
  const prompt = buildSummarizationPrompt(truncated, metadata);

  console.error("Calling inference for summarization...");
  const result = await inference({
    userPrompt: prompt,
    maxTokens: 4096,
    timeout: 60000,
  });

  if (!result.success || !result.text) {
    console.error(`Inference failed: ${result.error ?? "no response"}`);
    process.exit(0);
  }

  // Parse the summary output
  const summary = parseSummaryOutput(result.text);
  if (!summary) {
    console.error("Failed to parse inference output as summary");
    const shakaHome = resolveShakaHome();
    const memoryDir = `${shakaHome}/memory`;
    await saveFailedOutput(memoryDir, sessionId, result.text);
    process.exit(0);
  }

  // Write summary to disk
  const shakaHome = resolveShakaHome();
  const memoryDir = `${shakaHome}/memory`;
  const filePath = await writeSummary(memoryDir, summary);
  console.error(`Summary written to ${filePath}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Session-end hook error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  });
}
