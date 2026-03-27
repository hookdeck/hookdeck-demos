#!/usr/bin/env bash
# Create (or reset) a fixed demo branch with a single empty commit ahead of the
# default branch and push. Triggers handle-push without adding tracked file churn.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"

require_gh
cd_repo_root

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes before running the demo." >&2
  exit 1
fi

echo "Fetching origin…"
git fetch origin

DEFAULT="$(default_branch)"
echo "Using default branch: $DEFAULT"

echo "Checking out $DEFAULT and updating…"
git checkout "$DEFAULT"
git pull --ff-only origin "$DEFAULT"

echo "Resetting demo branch $DEMO_BRANCH to match $DEFAULT (local)…"
git checkout -B "$DEMO_BRANCH"

MSG="chore(demo): empty commit for Hookdeck/Trigger push ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
git commit --allow-empty -m "$MSG"

echo "Pushing $DEMO_BRANCH (force-with-lease keeps history on the demo branch tidy)…"
git push -u origin "refs/heads/$DEMO_BRANCH" --force-with-lease

echo ""
echo "Done. Push webhook should fire for branch: $DEMO_BRANCH"
echo "Open: $(gh repo view --json url -q .url)/tree/$DEMO_BRANCH"
