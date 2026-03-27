#!/usr/bin/env bash
# Shared helpers for demo scripts (sourced by other scripts in this directory).

set -euo pipefail

DEMO_BRANCH="${DEMO_BRANCH:-demo/hookdeck-trigger}"

require_gh() {
  if ! command -v gh &>/dev/null; then
    echo "Error: GitHub CLI (gh) is required. Install: https://cli.github.com" >&2
    exit 1
  fi
  if ! gh auth status &>/dev/null; then
    echo "Error: run \`gh auth login\` first." >&2
    exit 1
  fi
}

cd_repo_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$root" ]]; then
    echo "Error: not inside a git repository. Run from the github-ai-agent clone." >&2
    exit 1
  fi
  cd "$root"
}

default_branch() {
  gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
}
