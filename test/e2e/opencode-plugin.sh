#!/usr/bin/env bash
# E2E test: verifies shaka init produces a plugin that opencode can load.
# Must run inside Docker: docker compose run --rm opencode bash test/e2e/opencode-plugin.sh
set -eu

if [ ! -f /.dockerenv ]; then
  echo "ERROR: This test must run inside Docker."
  echo "  docker compose run --rm opencode bash test/e2e/opencode-plugin.sh"
  exit 1
fi

echo "E2E: opencode plugin"
echo

# Initialize shaka (bun link is already done at image build time)
bun link
bun run src/index.ts init

echo
echo "Running opencode..."

# Capture combined output — stderr has plugin loading logs, stdout has the response
OUTPUT=$(opencode run "what's your name?" 2>&1)

if echo "$OUTPUT" | grep -q "\[shaka\] Session context loaded"; then
  echo "PASS: opencode loaded shaka plugin"
else
  echo "FAIL: plugin did not load"
  echo "$OUTPUT"
  exit 1
fi
