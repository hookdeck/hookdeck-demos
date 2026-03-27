#!/usr/bin/env bash
# Push the demo branch (empty commit), then open a PR if none exists for that branch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"

require_gh
cd_repo_root

bash "$SCRIPT_DIR/push.sh"

BASE="$(default_branch)"
COUNT=$(gh pr list --head "$DEMO_BRANCH" --json number --jq 'length')

if [[ "${COUNT:-0}" -gt 0 ]]; then
  echo ""
  echo "A pull request for \`$DEMO_BRANCH\` already exists:"
  gh pr list --head "$DEMO_BRANCH"
  exit 0
fi

TITLE="Demo: AI PR review"
BODY="Created by \`npm run demo:pr\` for the Hookdeck + Trigger.dev demo. Safe to close after you see the AI review comment."

URL=$(gh pr create --base "$BASE" --head "$DEMO_BRANCH" --title "$TITLE" --body "$BODY")
echo ""
echo "Opened: $URL"
