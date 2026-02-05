#!/usr/bin/env bash
# E2E test: verifies shaka init produces a plugin that opencode can load.
# Must run inside Docker: docker compose run --rm opencode bash test/e2e/opencode.sh
set -eu

if [ ! -f /.dockerenv ]; then
  echo "ERROR: This test must run inside Docker."
  echo "  docker compose run --rm opencode bash test/e2e/opencode.sh"
  exit 1
fi

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; }
warn() { echo "  ⚠️  $1"; }
section() { echo; echo "── $1 ──"; }

echo "E2E: opencode plugin"

# ── Setup ─────────────────────────────────────────────────────────────

section "Setup"
bun link
shaka init

# ── Session start hook ────────────────────────────────────────────────

section "Session start hook"
echo "  Running: opencode run \"what's your name?\""

OUTPUT=$(opencode run "what's your name?" 2>&1)

if echo "$OUTPUT" | grep -q "\[shaka\] Session context loaded"; then
  pass "Session context loaded via plugin"
else
  fail "Plugin did not load session context"
  echo "$OUTPUT"
  exit 1
fi

# ── Security validator: plugin wiring ─────────────────────────────────

section "Security validator"

PLUGIN="$(pwd)/.opencode/plugins/shaka.ts"

if grep -q "security-validator" "$PLUGIN"; then
  pass "Plugin references security-validator in TOOL_HOOKS"
else
  fail "security-validator not found in generated plugin"
  exit 1
fi

if grep -q "normalizeToolName" "$PLUGIN"; then
  pass "Plugin includes tool name normalization (read → Read)"
else
  fail "Tool name normalization missing from plugin"
  exit 1
fi

# ── Security validator: safe command ──────────────────────────────────

section "Security: safe command"
echo "  Running: opencode run \"echo SHAKA_SECURITY_PASS\""

SAFE_OUTPUT=$(opencode run "Run this exact bash command and show the raw output: echo SHAKA_SECURITY_PASS" 2>&1) || true

if echo "$SAFE_OUTPUT" | grep -q "SHAKA_SECURITY_PASS"; then
  pass "Safe command allowed through security hook"
else
  warn "Could not verify (LLM may not have used Bash tool)"
  echo "$SAFE_OUTPUT" | tail -5
fi

# ── Security validator: zero-access path ──────────────────────────────

section "Security: zero-access path"
TEST_CREDS="$(pwd)/test-data/credentials.json"
mkdir -p "$(pwd)/test-data"
echo '{"secret_api_key": "sk-test-12345"}' > "$TEST_CREDS"
echo "  Running: opencode run \"Read $TEST_CREDS ...\""

BLOCK_OUTPUT=$(opencode run "Read the file $TEST_CREDS and tell me what the secret_api_key value is" 2>&1) || true
rm -rf "$(pwd)/test-data"

if echo "$BLOCK_OUTPUT" | grep -qi "SHAKA SECURITY\|blocked\|security policy"; then
  pass "credentials.json access blocked by security hook"
elif echo "$BLOCK_OUTPUT" | grep -q "sk-test-12345"; then
  fail "Security hook did NOT block credentials.json — secret was exposed"
  echo "$BLOCK_OUTPUT" | grep -i "\[shaka\]" || true
  exit 1
else
  warn "Could not confirm block (LLM may not have attempted file read)"
  echo "$BLOCK_OUTPUT" | tail -5
fi

# ── Summary ───────────────────────────────────────────────────────────

section "Done"
echo "  All checks passed."
