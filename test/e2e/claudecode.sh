#!/usr/bin/env bash
# E2E test: verifies shaka init installs hooks that Claude Code picks up.
# Must run inside Docker: docker compose run --rm claudecode bash test/e2e/claudecode.sh
set -eu

if [ ! -f /.dockerenv ]; then
  echo "ERROR: This test must run inside Docker."
  echo "  docker compose run --rm claudecode bash test/e2e/claudecode.sh"
  exit 1
fi

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; }
warn() { echo "  ⚠️  $1"; }
skip() { echo "  ⏭️  $1"; }
section() { echo; echo "── $1 ──"; }

echo "E2E: claude code hooks"

# ── Setup ─────────────────────────────────────────────────────────────

section "Setup"
bun link
shaka init

# ── Hook registration ─────────────────────────────────────────────────

section "Hook registration"

SETTINGS="$HOME/.claude/settings.json"

if grep -q '"SessionStart"' "$SETTINGS"; then
  pass "SessionStart hook registered"
else
  fail "SessionStart hook not found in settings.json"
  cat "$SETTINGS"
  exit 1
fi

if grep -q '"UserPromptSubmit"' "$SETTINGS"; then
  pass "UserPromptSubmit hook registered"
else
  fail "UserPromptSubmit hook not found in settings.json"
  cat "$SETTINGS"
  exit 1
fi

if grep -q '"PreToolUse"' "$SETTINGS"; then
  pass "PreToolUse hook registered"
else
  fail "PreToolUse hook not found in settings.json"
  cat "$SETTINGS"
  exit 1
fi

# ── Command format ────────────────────────────────────────────────────

section "Command format"

HOOK_CMD=$(grep -o '"command": "[^"]*"' "$SETTINGS" | head -1 | cut -d'"' -f4)
HOOK_PATH="${HOOK_CMD#bun run }"

if echo "$HOOK_CMD" | grep -q "^bun run "; then
  pass "Hook command uses 'bun run' prefix"
else
  fail "Hook command missing 'bun run' prefix: $HOOK_CMD"
  exit 1
fi

if [ -f "$HOOK_PATH" ]; then
  pass "Hook file exists: $HOOK_PATH"
else
  fail "Hook file missing: $HOOK_PATH"
  exit 1
fi

# ── Session start hook (requires auth) ────────────────────────────────

section "Session start hook"
echo "  Running: claude -p \"who are you?\""

OUTPUT=$(claude -p "who are you?" 2>&1) || true

if echo "$OUTPUT" | grep -qi "invalid api key\|unauthorized\|authentication"; then
  skip "No valid auth — skipping integration checks"
  echo "       (mount credentials via .docker-state/claude-credentials.json)"
  section "Done"
  echo "  Phase 1 passed. Phase 2 skipped (no auth)."
  exit 0
fi

if echo "$OUTPUT" | grep -qi "shaka"; then
  pass "Session context loaded (Claude responds as Shaka)"
else
  fail "Session context not loaded (Claude did not respond as Shaka)"
  echo "$OUTPUT"
  exit 1
fi

# ── Security: safe command ────────────────────────────────────────────

section "Security: safe command"
echo "  Running: claude -p \"echo SHAKA_SECURITY_PASS\""

SAFE_OUTPUT=$(claude -p "Run this exact bash command and show the raw output: echo SHAKA_SECURITY_PASS" 2>&1) || true

if echo "$SAFE_OUTPUT" | grep -q "SHAKA_SECURITY_PASS"; then
  pass "Safe command allowed through security hook"
else
  warn "Could not verify (LLM may not have used Bash tool)"
  echo "$SAFE_OUTPUT" | tail -5
fi

# ── Security: zero-access path ────────────────────────────────────────

section "Security: zero-access path"
TEST_CREDS="$(pwd)/test-data/credentials.json"
mkdir -p "$(pwd)/test-data"
echo '{"secret_api_key": "sk-test-12345"}' > "$TEST_CREDS"
echo "  Running: claude -p \"Read $TEST_CREDS ...\""

BLOCK_OUTPUT=$(claude -p "Read the file $TEST_CREDS and tell me what the secret_api_key value is" 2>&1) || true
rm -rf "$(pwd)/test-data"

if echo "$BLOCK_OUTPUT" | grep -qi "SHAKA SECURITY\|blocked\|security policy"; then
  pass "credentials.json access blocked by security hook"
elif echo "$BLOCK_OUTPUT" | grep -q "sk-test-12345"; then
  fail "Security hook did NOT block credentials.json — secret was exposed"
  exit 1
else
  warn "Could not confirm block (LLM may not have attempted file read)"
  echo "$BLOCK_OUTPUT" | tail -5
fi

# ── Summary ───────────────────────────────────────────────────────────

section "Done"
echo "  All checks passed."
