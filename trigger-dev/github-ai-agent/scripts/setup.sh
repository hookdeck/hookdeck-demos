#!/bin/bash
# setup.sh
#
# Interactive setup for the Trigger.dev GitHub AI agent demo.
# Walks through all credentials, auto-generates what it can,
# prompts for the rest, writes .env, then runs the setup scripts.
#
# Usage:
#   bash scripts/setup.sh          # interactive setup
#   bash scripts/setup.sh --check  # just verify .env is complete

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Colors for output
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✓${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
err()   { echo -e "${RED}✗${NC}  $1"; }
header() { echo -e "\n${BOLD}── $1 ──${NC}\n"; }

# Load existing .env if present
load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
  fi
}

# Write a key=value to .env (update if exists, append if not)
# Values are quoted to handle spaces (e.g., label names like "good first issue")
set_env() {
  local key="$1"
  local value="$2"
  if [ -f "$ENV_FILE" ] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # Update existing line - delete and re-append to handle quoting properly
    grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  echo "${key}=\"${value}\"" >> "$ENV_FILE"
  export "$key=$value"
}

# Prompt for a value, showing the current value if set
prompt_for() {
  local key="$1"
  local description="$2"
  local help_text="${3:-}"
  local current="${!key:-}"

  if [ -n "$current" ]; then
    echo -e "  ${DIM}Current value: ${current:0:20}...${NC}"
    read -p "  Keep current value? [Y/n]: " keep
    if [ "${keep,,}" != "n" ]; then
      ok "$key already set"
      return
    fi
  fi

  if [ -n "$help_text" ]; then
    echo -e "  ${DIM}${help_text}${NC}"
  fi

  read -p "  Enter $description: " value
  if [ -z "$value" ]; then
    err "$key is required"
    exit 1
  fi
  set_env "$key" "$value"
  ok "$key set"
}

# ─────────────────────────────────────────────────────────────
# Main setup flow
# ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Trigger.dev + Hookdeck: GitHub AI Agent Demo${NC}"
echo -e "${DIM}Interactive setup — generates what it can, prompts for the rest${NC}"
echo ""

# Start with existing .env or create from example
if [ -f "$ENV_FILE" ]; then
  info "Found existing .env file"
  load_env
else
  info "Creating .env from .env.example"
  cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
  load_env
fi

# ── 1. GitHub CLI ──────────────────────────────────────────

header "GitHub CLI"

if ! command -v gh &> /dev/null; then
  err "gh CLI not found. Install it: https://cli.github.com"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  err "gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

ok "gh CLI authenticated"

# GitHub API token for tasks (same name in .env and Trigger.dev)
if [ -z "${GITHUB_ACCESS_TOKEN:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  set_env "GITHUB_ACCESS_TOKEN" "$GITHUB_TOKEN"
  ok "Copied legacy GITHUB_TOKEN → GITHUB_ACCESS_TOKEN (you can delete GITHUB_TOKEN from .env)"
fi
if [ -z "${GITHUB_ACCESS_TOKEN:-}" ]; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
  if [ -n "$GH_TOKEN" ]; then
    set_env "GITHUB_ACCESS_TOKEN" "$GH_TOKEN"
    ok "GITHUB_ACCESS_TOKEN auto-detected from gh CLI"
  else
    prompt_for "GITHUB_ACCESS_TOKEN" "GitHub access token" "Create at: https://github.com/settings/tokens (repo scope)"
  fi
else
  ok "GITHUB_ACCESS_TOKEN already set"
fi

# Auto-detect repo
if [ -z "${GITHUB_REPO:-}" ]; then
  DETECTED_REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
  if [ -n "$DETECTED_REPO" ]; then
    echo -e "  ${DIM}Detected repo: ${DETECTED_REPO}${NC}"
    read -p "  Use this repo for the webhook? [Y/n]: " use_detected
    if [ "${use_detected,,}" != "n" ]; then
      set_env "GITHUB_REPO" "$DETECTED_REPO"
      ok "GITHUB_REPO set to $DETECTED_REPO"
    else
      prompt_for "GITHUB_REPO" "GitHub repo (owner/name)" "e.g., hookdeck/hookdeck-demos"
    fi
  else
    prompt_for "GITHUB_REPO" "GitHub repo (owner/name)" "e.g., hookdeck/hookdeck-demos"
  fi
else
  ok "GITHUB_REPO already set (${GITHUB_REPO})"
fi

# Auto-generate webhook secret
if [ -z "${GITHUB_WEBHOOK_SECRET:-}" ]; then
  GENERATED_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p 2>/dev/null || date +%s%N | sha256sum | head -c 64)
  set_env "GITHUB_WEBHOOK_SECRET" "$GENERATED_SECRET"
  ok "GITHUB_WEBHOOK_SECRET auto-generated"
else
  ok "GITHUB_WEBHOOK_SECRET already set"
fi

# Fetch available labels from the repo
if [ -z "${GITHUB_LABELS:-}" ]; then
  echo "  Fetching labels from $GITHUB_REPO..."
  REPO_LABELS=$(gh api "repos/$GITHUB_REPO/labels" --jq '.[].name' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
  if [ -n "$REPO_LABELS" ]; then
    set_env "GITHUB_LABELS" "$REPO_LABELS"
    ok "GITHUB_LABELS fetched from repo"
    echo -e "  ${DIM}Labels: ${REPO_LABELS}${NC}"
  else
    warn "Could not fetch labels — using defaults"
    set_env "GITHUB_LABELS" "bug,enhancement,question,documentation"
  fi
else
  ok "GITHUB_LABELS already set"
fi

# ── 2. Hookdeck ───────────────────────────────────────────

header "Hookdeck"

if ! command -v hookdeck &> /dev/null; then
  err "Hookdeck CLI not found. Install it: https://hookdeck.com/docs/cli"
  exit 1
fi

ok "Hookdeck CLI installed"

prompt_for "HOOKDECK_API_KEY" "Hookdeck API key" \
  "Dashboard → Project Settings → API Keys (https://dashboard.hookdeck.com)"

# ── 3. Trigger.dev ────────────────────────────────────────

header "Trigger.dev"

prompt_for "TRIGGER_SECRET_KEY" "Trigger.dev Production secret key" \
  "Dashboard → API keys → Production (must start with tr_prod_) https://cloud.trigger.dev"

prompt_for "TRIGGER_PROJECT_REF" "Trigger.dev project ref" \
  "Project settings → General (e.g., proj_xxxx) https://cloud.trigger.dev"

# ── 4. Anthropic ──────────────────────────────────────────

header "Anthropic (Claude API)"

prompt_for "ANTHROPIC_API_KEY" "Anthropic API key" \
  "Get one at: https://console.anthropic.com/settings/keys"

# ── 5. Slack (optional) ──────────────────────────────────

header "Slack (optional — for deployment notifications)"

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo -e "  ${DIM}The handle-push task posts deployment summaries to Slack.${NC}"
  echo -e "  ${DIM}To set up: Slack → Apps → Create New App → Incoming Webhooks${NC}"
  echo -e "  ${DIM}→ Add New Webhook to Workspace → pick a channel → copy the URL${NC}"
  echo ""
  read -p "  Enter Slack webhook URL (or press Enter to skip): " slack_url
  if [ -n "$slack_url" ]; then
    set_env "SLACK_WEBHOOK_URL" "$slack_url"
    ok "SLACK_WEBHOOK_URL set"
  else
    warn "Skipped — handle-push task will log to console instead"
    set_env "SLACK_WEBHOOK_URL" ""
  fi
else
  ok "SLACK_WEBHOOK_URL already set"
fi

# ── Summary ───────────────────────────────────────────────

header "Configuration summary"

# Helper to show masked status
show_var() {
  local name="$1"
  local label="${2:-}"
  local value="${!name:-}"
  local pad=$(printf "%-24s" "$name")
  if [ -n "$value" ]; then
    if [ -n "$label" ]; then
      echo -e "  ${pad} ${GREEN}$label${NC}"
    else
      echo -e "  ${pad} ${GREEN}set${NC}"
    fi
  else
    echo -e "  ${pad} ${RED}not set${NC}"
  fi
}

show_var "GITHUB_REPO"
show_var "GITHUB_ACCESS_TOKEN" "auto-detected (gh CLI)"
show_var "GITHUB_WEBHOOK_SECRET" "auto-generated"
show_var "GITHUB_LABELS" "fetched from repo"
show_var "HOOKDECK_API_KEY"
show_var "TRIGGER_SECRET_KEY"
show_var "TRIGGER_PROJECT_REF"
show_var "ANTHROPIC_API_KEY"
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  show_var "SLACK_WEBHOOK_URL"
else
  printf "  %-24s ${YELLOW}skipped${NC}\n" "SLACK_WEBHOOK_URL"
fi
echo ""

# ── Check mode: stop here ─────────────────────────────────

if [ "${1:-}" = "--check" ]; then
  info "Check complete. Run without --check to proceed with setup."
  exit 0
fi

# ── Run setup steps ───────────────────────────────────────

header "Step 1/3: Deploy Trigger.dev tasks"

# This demo is Production-only: Hookdeck must use the Production API key (tr_prod_...).
if [ -n "${TRIGGER_SECRET_KEY:-}" ]; then
  case "$TRIGGER_SECRET_KEY" in
    tr_dev_*|tr_stg_*)
      err "TRIGGER_SECRET_KEY must be a Production secret (tr_prod_...). This demo does not use Development or Staging."
      err "Create or copy a Production key in Trigger.dev → API keys, update .env, then run setup again."
      exit 1
      ;;
    tr_prod_*) ;;
    *)
      warn "TRIGGER_SECRET_KEY does not start with tr_prod_. Use a Production key or setup may fail."
      ;;
  esac
fi

echo -e "  ${DIM}Running: npm run deploy:prod (Trigger.dev Production environment)${NC}"
cd "$PROJECT_DIR"
npm run deploy:prod

echo ""
header "Step 2/3: Create Hookdeck resources"

bash "$SCRIPT_DIR/setup-hookdeck.sh"

echo ""
header "Step 3/3: Register GitHub webhook"

bash "$SCRIPT_DIR/setup-github-webhook.sh"

# ── Done ──────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "  Next steps:"
echo "    npm run deploy        # redeploy task code to Trigger.dev Production after changes"
echo ""
echo "  Test it:"
echo "    • Create an issue on ${GITHUB_REPO} → watch it get labeled"
echo "    • Open a PR → watch for the AI review comment"
echo "    • Push to main → check Slack for the deployment summary"
echo ""
echo "  Dashboards:"
echo "    • Hookdeck:    https://dashboard.hookdeck.com"
echo "    • Trigger.dev: https://cloud.trigger.dev"
echo ""
