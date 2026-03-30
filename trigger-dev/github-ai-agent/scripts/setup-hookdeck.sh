#!/bin/bash
# setup-hookdeck.sh
#
# Creates Hookdeck resources for the Trigger.dev GitHub AI agent demo.
# Idempotent: safe to run multiple times (uses connection upsert).
#
# Prerequisites:
#   - hookdeck CLI >= 2.0.0 (so --rule-filter-headers JSON is stored as an object, not a string)
#   - .env file with HOOKDECK_API_KEY, GITHUB_WEBHOOK_SECRET, TRIGGER_SECRET_KEY
#
# Supports both Trigger.dev task router (single connection) and Hookdeck connection routing (per-event).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Require Hookdeck CLI >= 2.0.0 (JSON filter flags; see hookdeck-cli #262 / v2.0.0).
MIN_HOOKDECK_VERSION="2.0.0"
if ! command -v hookdeck >/dev/null 2>&1; then
  echo "Error: hookdeck CLI not found in PATH. Install: https://hookdeck.com/docs/cli"
  exit 1
fi
HOOKDECK_VERSION_RAW=$(hookdeck version 2>/dev/null | head -n1 || true)
HOOKDECK_VERSION=$(echo "$HOOKDECK_VERSION_RAW" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
if [ -z "$HOOKDECK_VERSION" ]; then
  echo "Error: could not parse hookdeck version from: ${HOOKDECK_VERSION_RAW:-<empty>}"
  exit 1
fi
if [ "$(printf '%s\n' "$MIN_HOOKDECK_VERSION" "$HOOKDECK_VERSION" | sort -V | head -n1)" != "$MIN_HOOKDECK_VERSION" ]; then
  echo "Error: hookdeck CLI must be >= $MIN_HOOKDECK_VERSION for correct connection filter rules (found $HOOKDECK_VERSION)."
  echo "  Upgrade: brew upgrade hookdeck  or  https://github.com/hookdeck/hookdeck-cli/releases"
  exit 1
fi
echo "Using hookdeck CLI $HOOKDECK_VERSION (>= $MIN_HOOKDECK_VERSION required)"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# Validate required env vars
for var in HOOKDECK_API_KEY GITHUB_WEBHOOK_SECRET TRIGGER_SECRET_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set. See .env.example."
    exit 1
  fi
done

# Optional dry-run mode
DRY_RUN_FLAG=""
if [ "${DRY_RUN:-}" = "true" ]; then
  DRY_RUN_FLAG="--dry-run"
  echo "=== DRY RUN MODE ==="
fi

TRIGGER_BASE_URL="https://api.trigger.dev/api/v1/tasks"

# Read transformation code from file
TRANSFORM_CODE=$(cat "$PROJECT_DIR/hookdeck/trigger-wrapper.js")

# Authenticate with Hookdeck (non-interactive, for scripts/CI)
echo "Authenticating with Hookdeck..."
hookdeck ci --api-key "$HOOKDECK_API_KEY"

echo ""
echo "=== Trigger.dev task router (single connection) ==="
echo ""

# Create the first connection and capture output to extract the Source URL
CONNECTION_OUTPUT=$(hookdeck gateway connection upsert "github-to-main-handler" \
  --source-name "github" \
  --source-type GITHUB \
  --source-webhook-secret "$GITHUB_WEBHOOK_SECRET" \
  --source-allowed-http-methods "POST" \
  --destination-name "trigger-dev-main" \
  --destination-type HTTP \
  --destination-url "$TRIGGER_BASE_URL/github-webhook-handler/trigger" \
  --destination-auth-method bearer \
  --destination-bearer-token "$TRIGGER_SECRET_KEY" \
  --rule-transform-name "trigger-wrapper" \
  --rule-transform-code "$TRANSFORM_CODE" \
  --rule-retry-count 5 \
  --rule-retry-strategy linear \
  --rule-retry-interval 60000 \
  $DRY_RUN_FLAG 2>&1)

echo "$CONNECTION_OUTPUT"

# Extract Source URL from the connection output using Python (more portable than jq)
HOOKDECK_SOURCE_URL=$(echo "$CONNECTION_OUTPUT" | python3 -c "
import sys
for line in sys.stdin:
    if 'Source URL:' in line:
        # Format is 'Source URL:  https://hkdk.events/xxx'
        print(line.split('Source URL:')[1].strip())
        break
" 2>/dev/null || true)

# Export for later use by setup-github-webhook.sh
if [ -n "$HOOKDECK_SOURCE_URL" ]; then
  export HOOKDECK_SOURCE_URL
fi

echo ""
echo "=== Hookdeck connection routing (per-event) ==="
echo ""
# Filtered connections reference the same named transform as github-to-main-handler.
# The name trigger-wrapper is unique in the project; code was set on the upsert above.

# PR events
echo "Creating connection: github-to-handle-pr"
hookdeck gateway connection upsert "github-to-handle-pr" \
  --source-name "github" \
  --source-type GITHUB \
  --destination-name "trigger-dev-pr" \
  --destination-type HTTP \
  --destination-url "$TRIGGER_BASE_URL/handle-pr/trigger" \
  --destination-auth-method bearer \
  --destination-bearer-token "$TRIGGER_SECRET_KEY" \
  --rule-filter-headers '{"x-github-event":{"$eq":"pull_request"}}' \
  --rule-transform-name "trigger-wrapper" \
  --rule-retry-count 5 \
  --rule-retry-strategy linear \
  --rule-retry-interval 60000 \
  $DRY_RUN_FLAG

echo ""

# Issue events
echo "Creating connection: github-to-handle-issue"
hookdeck gateway connection upsert "github-to-handle-issue" \
  --source-name "github" \
  --source-type GITHUB \
  --destination-name "trigger-dev-issues" \
  --destination-type HTTP \
  --destination-url "$TRIGGER_BASE_URL/handle-issue/trigger" \
  --destination-auth-method bearer \
  --destination-bearer-token "$TRIGGER_SECRET_KEY" \
  --rule-filter-headers '{"x-github-event":{"$eq":"issues"}}' \
  --rule-transform-name "trigger-wrapper" \
  --rule-retry-count 5 \
  --rule-retry-strategy linear \
  --rule-retry-interval 60000 \
  $DRY_RUN_FLAG

echo ""

# Push events
echo "Creating connection: github-to-handle-push"
hookdeck gateway connection upsert "github-to-handle-push" \
  --source-name "github" \
  --source-type GITHUB \
  --destination-name "trigger-dev-push" \
  --destination-type HTTP \
  --destination-url "$TRIGGER_BASE_URL/handle-push/trigger" \
  --destination-auth-method bearer \
  --destination-bearer-token "$TRIGGER_SECRET_KEY" \
  --rule-filter-headers '{"x-github-event":{"$eq":"push"}}' \
  --rule-transform-name "trigger-wrapper" \
  --rule-retry-count 5 \
  --rule-retry-strategy linear \
  --rule-retry-interval 60000 \
  $DRY_RUN_FLAG

echo ""
echo "=== Hookdeck setup complete ==="
echo ""

# Output the Source URL that was captured during connection creation
if [ -n "${HOOKDECK_SOURCE_URL:-}" ]; then
  echo "Source URL (register this with GitHub):"
  echo "  $HOOKDECK_SOURCE_URL"
  
  # Save to a temp file so setup-github-webhook.sh can read it
  echo "$HOOKDECK_SOURCE_URL" > "$PROJECT_DIR/.hookdeck-source-url"
else
  echo "Source URL: (could not extract — check the Hookdeck dashboard)"
fi
echo ""
