#!/bin/bash
# setup-hookdeck.sh
#
# Creates Hookdeck resources for the Trigger.dev GitHub AI agent demo.
# Idempotent: safe to run multiple times (uses connection upsert).
#
# Prerequisites:
#   - hookdeck CLI installed (v1.2.0+)
#   - .env file with HOOKDECK_API_KEY, GITHUB_WEBHOOK_SECRET, TRIGGER_SECRET_KEY
#
# Supports both Pattern A (fan-out) and Pattern B (per-event routing).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

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
echo "=== Pattern A: Single main task (fan-out) ==="
echo ""

hookdeck gateway connection upsert "github-to-main-handler" \
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
  $DRY_RUN_FLAG

echo ""
echo "=== Pattern B: Per-event routing ==="
echo ""

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
  $DRY_RUN_FLAG

echo ""
echo "=== Hookdeck setup complete ==="
echo ""
echo "Source URL (register this with GitHub):"
hookdeck gateway source get github --output json 2>/dev/null | grep -o '"url":"[^"]*"' | cut -d'"' -f4 || echo "  (run without --dry-run to see the URL)"
echo ""
