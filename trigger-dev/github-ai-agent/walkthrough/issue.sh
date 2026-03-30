#!/usr/bin/env bash
# Open a throwaway issue to exercise handle-issue (AI labels).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"

require_gh
cd_repo_root

TITLE="Demo: issue labeler ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
BODY="Created by \`npm run demo:issue\` for the Hookdeck + Trigger.dev GitHub AI demo. Safe to close."

URL=$(gh issue create --title "$TITLE" --body "$BODY")
echo "Created: $URL"
