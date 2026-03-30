#!/bin/bash
# setup-github-webhook.sh
#
# Registers a GitHub webhook pointing to the Hookdeck source URL.
# Checks for an existing webhook first to avoid duplicates.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - .env file with GITHUB_REPO, GITHUB_WEBHOOK_SECRET
#   - Hookdeck setup already run (source URL must exist)

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
for var in GITHUB_REPO GITHUB_WEBHOOK_SECRET HOOKDECK_API_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set. See .env.example."
    exit 1
  fi
done

# Get the Hookdeck source URL
echo "Getting Hookdeck source URL..."

# First, check if setup-hookdeck.sh saved the URL to a file
SOURCE_URL_FILE="$PROJECT_DIR/.hookdeck-source-url"
if [ -f "$SOURCE_URL_FILE" ]; then
  HOOKDECK_SOURCE_URL=$(cat "$SOURCE_URL_FILE")
  echo "  Found saved URL from Hookdeck setup"
fi

# If not found in file, try to fetch it via the CLI
if [ -z "${HOOKDECK_SOURCE_URL:-}" ]; then
  echo "  Fetching from Hookdeck API..."
  hookdeck ci --api-key "$HOOKDECK_API_KEY" 2>/dev/null
  
  # Try to get the source and parse the URL using Python (more portable than jq)
  SOURCE_JSON=$(hookdeck gateway source get github --output json 2>/dev/null || true)
  if [ -n "$SOURCE_JSON" ]; then
    HOOKDECK_SOURCE_URL=$(echo "$SOURCE_JSON" | python3 -c "
import sys
import json
try:
    data = json.load(sys.stdin)
    print(data.get('url', ''))
except:
    pass
" 2>/dev/null || true)
  fi
fi

if [ -z "${HOOKDECK_SOURCE_URL:-}" ]; then
  echo "Error: Could not get Hookdeck source URL."
  echo "  Run setup-hookdeck.sh first, or set HOOKDECK_SOURCE_URL in .env"
  exit 1
fi

echo "Hookdeck source URL: $HOOKDECK_SOURCE_URL"

# Check for existing webhook pointing to this URL
echo "Checking for existing webhook on $GITHUB_REPO..."
EXISTING_HOOK_ID=$(gh api "repos/$GITHUB_REPO/hooks" --jq ".[] | select(.config.url == \"$HOOKDECK_SOURCE_URL\") | .id" 2>/dev/null || true)

if [ -n "$EXISTING_HOOK_ID" ]; then
  echo "Found existing webhook (ID: $EXISTING_HOOK_ID). Updating..."
  gh api "repos/$GITHUB_REPO/hooks/$EXISTING_HOOK_ID" \
    --method PATCH \
    -f "config[url]=$HOOKDECK_SOURCE_URL" \
    -f "config[content_type]=json" \
    -f "config[secret]=$GITHUB_WEBHOOK_SECRET" \
    -f "events[]=pull_request" \
    -f "events[]=issues" \
    -f "events[]=push" \
    -F "active=true" \
    --silent
  echo "Webhook updated successfully."
else
  echo "Creating new webhook..."
  gh api "repos/$GITHUB_REPO/hooks" \
    --method POST \
    -f "name=web" \
    -f "config[url]=$HOOKDECK_SOURCE_URL" \
    -f "config[content_type]=json" \
    -f "config[secret]=$GITHUB_WEBHOOK_SECRET" \
    -f "events[]=pull_request" \
    -f "events[]=issues" \
    -f "events[]=push" \
    -F "active=true" \
    --silent
  echo "Webhook created successfully."
fi

echo ""
echo "GitHub webhook configured for $GITHUB_REPO"
echo "  URL: $HOOKDECK_SOURCE_URL"
echo "  Events: pull_request, issues, push"
