# Trigger.dev x Hookdeck: Validated Build Plan

**Date:** March 19, 2026
**Target delivery:** ~March 30, 2026 (2 weeks from March 16 call)
**Author:** Phil Leggetter

---

## Execution status

*Last updated: March 2026*

| Phase | Status |
|-------|--------|
| **Phase 1–3** | **Done** — Trigger.dev deploy, Hookdeck resources (incl. Pattern A + B connections from `setup-hookdeck.sh`), GitHub webhook registered. |
| **Phase 4 (Pattern A)** | **Mostly done** — Issue labeler, PR AI review, push → Slack validated; Hookdeck + Trigger.dev dashboards checked for those paths. **Open:** send an **unsupported** GitHub event (e.g. `star`, if enabled on the webhook) and confirm Pattern A behavior in `github-webhook-handler` (ignored / default branch of `switch`). |
| **Phase 4b (Pattern B)** | **Next** — Exercise the **header-filtered** connections (`github-to-handle-pr`, `github-to-handle-issue`, `github-to-handle-push`) end-to-end: same repo events, verify each task runs **only** for its event type, Hookdeck shows **per-connection** delivery, and each task still calls `verifyHookdeckEvent` independently. Optionally confirm an unsupported event **does not** create deliveries on Pattern B connections (or only hits Pattern A if both are active — document actual wiring). |
| **Pros / cons** | **Next** — Validate the trade-off table below against real runs (observability, deploy vs dashboard change, noise). Capture 2–3 sentences for the guide. |
| **Phase 5 (Guide)** | **After** Phase 4 complete + Pattern B tested + trade-offs agreed — draft the Trigger.dev + Hookdeck guide with screenshots, both patterns, verification chain, transformation. |

**Guide dependencies:** Pattern B E2E + trade-off notes → then Phase 5. Skills repo PR to `triggerdotdev/skills` remains **after** the guide is published (see Open Items).

---

## Resolved Technical Questions

The context doc flagged five open questions. Here's what the research confirmed.

### 1. Can Hookdeck filter rules match on request headers?

**Yes, confirmed.** Hookdeck filters support a Headers tab alongside Body, Query, and Path. The JSON syntax for header filtering uses the same operators as body filters.

Example for GitHub event type filtering:

```json
{
  "X-GitHub-Event": {
    "$eq": "pull_request"
  }
}
```

The CLI also supports `--filter-headers '{"x-github-event":"pull_request"}'`. This confirms Pattern B (Hookdeck routing to different tasks per event type) is fully viable using header-based filter rules.

### 2. What verification headers does Hookdeck add when forwarding?

**Confirmed: two headers.**

- `x-hookdeck-verified: true` — added when source verification is enabled and the incoming request passes signature verification. Confirms the original webhook was authenticated.
- `x-hookdeck-signature` — always added, generated using the Hookdeck project's signing secret and the forwarded request data. This lets the destination independently verify the request came through Hookdeck.

The original provider headers (e.g., `X-Hub-Signature-256` from GitHub) are also forwarded by default, though the signature won't re-verify because the body may be transformed.

**Implication for the guide:** The verification chain is: GitHub HMAC verified at Hookdeck source, then `x-hookdeck-verified: true` confirms this downstream. The Trigger.dev task receives only verified events. The guide should explain this chain clearly and recommend trusting it rather than attempting to re-verify the GitHub HMAC after transformation.

### 3. Can transformations access request headers?

**Yes, confirmed.** The transformation `request` object has this shape:

```typescript
{
  headers: { [key: string]: string };
  body: string | boolean | number | object | null;
  query: string;
  parsed_query: object;
  path: string;
}
```

The `addHandler("transform", (request, context) => { ... return request; })` pattern is confirmed. You can read headers and modify the body. The `context` object contains `{ connection: Connection }`.

**Validated transformation code** for wrapping the payload with the GitHub event type:

```javascript
addHandler("transform", (request, context) => {
  request.body = {
    payload: {
      _hookdeck: {
        verified: request.headers["x-hookdeck-verified"] === "true",
        signature: request.headers["x-hookdeck-signature"],
      },
      event: request.headers["x-github-event"],
      action: request.body.action,
      ...request.body,
    },
  };
  return request;
});
```

**Note:** The handler must return a valid request object with a valid `content-type` header. Existing Hookdeck transformations in the Radar project confirm this pattern works (e.g., `grafana-to-public-alert` transformation reads `request.body` and sets `request.headers`).

### 4. Trigger.dev task trigger API format

**Confirmed from docs.**

**Endpoint:** `POST https://api.trigger.dev/api/v1/tasks/{taskIdentifier}/trigger`

**Authentication:** `Authorization: Bearer <TRIGGER_SECRET_KEY>` — keys start with `tr_dev_`, `tr_prod_`, or `tr_stg_`.

**Request body:**

```json
{
  "payload": { ... },
  "context": { ... },
  "options": {
    "idempotencyKey": "...",
    "concurrencyKey": "...",
    "queue": { "name": "...", "concurrencyLimit": 1 }
  }
}
```

Only `payload` is required. The `context` and `options` fields are optional.

**Task code pattern (TypeScript):**

```typescript
import { task } from "@trigger.dev/sdk";

export const webhookHandler = task({
  id: "webhook-handler",
  run: async (payload: Record<string, unknown>) => {
    console.log("Received webhook:", payload);
    // payload is the unwrapped data from the "payload" field
  },
});
```

**Response:** `{ "id": "run_1234" }` on success (200).

### 5. Payload size considerations

Not explicitly documented for either platform. GitHub webhook payloads are typically small (a few KB for most events, up to ~100KB for large PR or push events with many commits). No practical concern for this demo.

---

## Current State of Trigger.dev's Hookdeck Guide

The existing guide at `trigger.dev/docs/guides/examples/hookdeck-webhook` is minimal — a single pattern:

1. Create a destination pointing to `https://api.trigger.dev/api/v1/tasks/<task-id>/trigger` with Bearer auth
2. Add a transformation that wraps the body: `request.body = { payload: { ...request.body } }`
3. Create a connection linking source to destination

It shows a generic `webhookHandler` task receiving `Record<string, unknown>`. No GitHub-specific patterns, no header filtering, no multi-connection routing. This is the baseline we're improving on.

---

## Hookdeck Project Setup

**New project needed.** The current Hookdeck account has many projects across several orgs ("Demos", "Examples", etc.). The demo should use a new dedicated project.

**Recommended:** Create a new project in the "Demos" org called `trigger-dev-github-webhooks` (or similar).

### Resources to create during build

**Source (shared by both patterns):**

| Resource | Configuration |
|----------|--------------|
| Name | `github` |
| Verification | GitHub (HMAC SHA-256 using `X-Hub-Signature-256`) |
| Allowed methods | POST |
| Webhook secret | Set during GitHub webhook registration |

**Transformation (shared by all connections):**

| Resource | Configuration |
|----------|--------------|
| Name | `trigger-wrapper` |
| Code | See transformation code below |

```javascript
addHandler("transform", (request, context) => {
  request.body = {
    payload: {
      _hookdeck: {
        verified: request.headers["x-hookdeck-verified"] === "true",
        signature: request.headers["x-hookdeck-signature"],
      },
      event: request.headers["x-github-event"],
      action: request.body.action,
      ...request.body,
    },
  };
  return request;
});
```

### Pattern A: Single Main Task (Fan-out)

| Resource | Type | Configuration |
|----------|------|--------------|
| `trigger-dev-main` | Destination | URL: `https://api.trigger.dev/api/v1/tasks/github-webhook-handler/trigger`, Auth: Bearer `TRIGGER_SECRET_KEY` |
| `github → trigger-dev-main` | Connection | Source: `github`, Destination: `trigger-dev-main`, Transform: `trigger-wrapper`, Retry: 5 attempts / linear |

The single Trigger.dev task receives all event types and uses the `event` field to fan out:

```typescript
import { task } from "@trigger.dev/sdk";

// Main handler — receives all GitHub events via Hookdeck
export const githubWebhookHandler = task({
  id: "github-webhook-handler",
  run: async (payload: {
    event: string;
    action?: string;
    [key: string]: unknown;
  }) => {
    switch (payload.event) {
      case "pull_request":
        // trigger handlePR task
        break;
      case "issues":
        // trigger handleIssue task
        break;
      case "push":
        // trigger handlePush task
        break;
      default:
        console.log(`Unhandled event: ${payload.event}`);
    }
  },
});
```

### Pattern B: Hookdeck Routes to Different Tasks

| Resource | Type | Configuration |
|----------|------|--------------|
| `trigger-dev-pr` | Destination | URL: `.../tasks/handle-pr/trigger`, Auth: Bearer `TRIGGER_SECRET_KEY` |
| `trigger-dev-issues` | Destination | URL: `.../tasks/handle-issue/trigger`, Auth: Bearer `TRIGGER_SECRET_KEY` |
| `trigger-dev-push` | Destination | URL: `.../tasks/handle-push/trigger`, Auth: Bearer `TRIGGER_SECRET_KEY` |
| `github → trigger-dev-pr` | Connection | Filter (headers): `{ "X-GitHub-Event": { "$eq": "pull_request" } }`, Transform: `trigger-wrapper` |
| `github → trigger-dev-issues` | Connection | Filter (headers): `{ "X-GitHub-Event": { "$eq": "issues" } }`, Transform: `trigger-wrapper` |
| `github → trigger-dev-push` | Connection | Filter (headers): `{ "X-GitHub-Event": { "$eq": "push" } }`, Transform: `trigger-wrapper` |

Each Trigger.dev task is purpose-built:

```typescript
import { task } from "@trigger.dev/sdk";

export const handlePR = task({
  id: "handle-pr",
  run: async (payload: {
    event: "pull_request";
    action: string;
    number: number;
    pull_request: Record<string, unknown>;
    repository: Record<string, unknown>;
  }) => {
    console.log(`PR #${payload.number}: ${payload.action}`);
    // PR-specific logic
  },
});

export const handleIssue = task({
  id: "handle-issue",
  run: async (payload: {
    event: "issues";
    action: string;
    issue: Record<string, unknown>;
    repository: Record<string, unknown>;
  }) => {
    // Issue-specific logic
  },
});

export const handlePush = task({
  id: "handle-push",
  run: async (payload: {
    event: "push";
    ref: string;
    commits: Array<Record<string, unknown>>;
    repository: Record<string, unknown>;
  }) => {
    // Skip non-default branch pushes
    // Summarize commits with LLM
    // Post to Slack
  },
});
```

---

## Build Steps (Execution Order)

### Phase 0: Rename and reorganize `hookdeck-demos` repo

Before adding the Trigger.dev demo, rename and reorganize the existing repo.

**Rename:** `hookdeck/hookdeck-demos` → `hookdeck/hookdeck-demoss` (plural). GitHub automatically redirects the old URL, so existing links won't break. Update any CI workflows, bookmarks, or documentation that reference the old name.

**Reorganize:** Adopt a consistent `vendor/use-case/` directory convention. Hookdeck itself is treated as a vendor — the demos are typically feature demos.

**Current state → new location:**

| Current directory | New location | Notes |
|---|---|---|
| `ai/deepgram/` | `deepgram/stt-tts/` | Vendor-first, use-case second |
| `stripe-fetch-before-process/` | `stripe/fetch-before-process/` | |
| `shopify-webhooks-at-scale/` | `shopify/webhooks-at-scale/` | |
| `deduplication/` | `hookdeck/deduplication/` | Hookdeck feature demo |
| `transformation-reording/` | `hookdeck/transformation-reordering/` | Fix the typo while we're at it |
| `session-filters/` | `hookdeck/session-filters/` | Hookdeck feature demo |
| `cli-overview/` | `hookdeck/cli-overview/` | Hookdeck tooling demo |
| `general/` | `hookdeck/general/` | General webhook handling |
| `demo_scripts/` | `hookdeck/demo-scripts/` | Normalize to kebab-case |
| `tmux-presenter/` | `_shared/tmux-presenter/` | Shared utility for running tmux-based live demos — not a vendor demo itself, but used by demos across vendors |

**New directory after reorg + Trigger.dev demo added:**

```
hookdeck-demos/
  hookdeck/
    cli-overview/
    deduplication/
    demo-scripts/
    general/
    session-filters/
    transformation-reordering/
  stripe/
    fetch-before-process/
  shopify/
    webhooks-at-scale/
  deepgram/
    stt-tts/
  trigger-dev/
    github-ai-agent/              # ← the new demo
  _shared/
    tmux-presenter/               # shared utility for tmux-based live demos
  .prettierrc
  README.md
```

**Implementation notes:**

- Use `git mv` for all renames so history is preserved.
- Update the root `README.md` to reflect the new structure.
- Update any internal path references within each demo (READMEs, scripts, CI workflows if any).
- This is a single PR, merged before the Trigger.dev demo work begins.
- The convention going forward: every new demo goes in `vendor/use-case/`. Hookdeck is a vendor like any other.

### Phase 1: Trigger.dev project setup

1. Create a new Trigger.dev project (or use an existing dev project)
2. Deploy the task definitions (all tasks for both patterns)
3. Note the `TRIGGER_SECRET_KEY` for Hookdeck destination auth
4. Verify tasks appear in the Trigger.dev dashboard

### Phase 2: Hookdeck project setup

1. Create a new Hookdeck project in the "Demos" org
2. Create the `github` source with GitHub verification
3. Create the `trigger-wrapper` transformation
4. **Pattern A:** Create destination + connection (no filter, transformation applied)
5. **Pattern B:** Create 3 destinations + 3 connections (each with header filter + shared transformation)

### Phase 3: GitHub webhook registration

1. Choose a test repo (or create one)
2. Register a webhook pointing to the Hookdeck source URL
3. Set the webhook secret (same value configured in Hookdeck source verification)
4. Select events: `pull_request`, `issues`, `push`

### Phase 4: End-to-end testing

**Pattern A (single connection → `github-webhook-handler` → fan-out)** — *largely complete*

1. ~~Create a test issue~~ → `handle-issue` via router
2. ~~Open a test PR~~ → `handle-pr` via router
3. ~~Push a commit~~ → `handle-push` via router (incl. Slack)
4. ~~Check Hookdeck dashboard~~ for those events: received, verified, transformed, delivered
5. ~~Check Trigger.dev dashboard~~: runs for router + child tasks with correct payloads
6. **Remaining:** **Unsupported event** — Enable a webhook event **not** handled in the router (e.g. `star` or `watch`) *or* simulate payload; confirm router hits `default` / “Ignoring event” and **no** erroneous child triggers. Document result for the guide.

**Pattern B (per-event Hookdeck connections → dedicated tasks)** — *next*

7. With `setup-hookdeck.sh` connections active, trigger **issues** / **pull_request** / **push** and confirm **each** flows through the **matching** connection only (`github-to-handle-*`), destinations point at `handle-pr` / `handle-issue` / `handle-push` directly (not only via router). Compare Hookdeck **connection-level** logs vs Pattern A’s single connection.
8. Confirm **verification** runs in each task (Pattern B path). Optionally compare run counts vs Pattern A for the same repo activity (duplicate deliveries if **both** Pattern A and B connections are enabled — clarify in guide: typically test Pattern B with understanding that setup script creates **both** patterns; may need to pause/disable Pattern A connection for clean Pattern B-only testing, or document dual-delivery behavior).

### Phase 4b: Pros / cons validation (for guide)

Before Phase 5, sanity-check the **Trade-offs** table (below) against experience: routing in code vs Hookdeck, deploy vs dashboard for new event types, observability, retries. Add a short “When to use A vs B” subsection outline for the guide.

### Phase 5: Guide drafting

**Prerequisites:** Phase 4 item (6) done; Phase 4 Pattern B steps (7–8) done; Phase 4b notes captured.

1. Write the guide based on validated patterns and real screenshots
2. Include both patterns with trade-off discussion (use Phase 4b notes)
3. Cover: setup, verification chain, transformation, testing, when to use which pattern
4. Optional: link from Trigger.dev docs / skills repo after publish

---

## Trade-offs for the Guide (Pattern A vs Pattern B)

| Consideration | Pattern A (Fan-out) | Pattern B (Hookdeck Routing) |
|--------------|--------------------|-----------------------------|
| Hookdeck resources | 1 connection, 1 destination | N connections, N destinations |
| Routing logic | In Trigger.dev task code | In Hookdeck filter rules |
| Adding new event types | Code change + deploy | New connection in Hookdeck dashboard |
| Observability | All events in one Hookdeck connection | Each event type visible separately |
| Retry granularity | Same retry policy for all events | Per-event-type retry policies |
| Best for | Simple setups, few event types | Complex routing, many event types, per-type config |

---

## Project Setup Automation

The goal is: clone the repo, add API keys to a `.env` file, run a setup script, and everything is configured. No clicking around in dashboards.

### Developer experience (target)

```
git clone https://github.com/hookdeck/hookdeck-demos
cd hookdeck-demos/trigger-dev/github-ai-agent
cp .env.example .env
# Edit .env with your keys (see below)
npm install
npm run setup        # deploys Trigger.dev tasks (Production) + Hookdeck + GitHub webhook
npm run deploy       # redeploy task code to Production after changes
```

### What goes in `.env`

```bash
# Hookdeck
HOOKDECK_API_KEY=            # Project API key (from Hookdeck dashboard → Project Settings → API Keys)
GITHUB_WEBHOOK_SECRET=       # Shared secret for GitHub webhook HMAC verification

# Trigger.dev
TRIGGER_SECRET_KEY=          # Production API key (tr_prod_...) — demo is Production-only; Hookdeck uses this Bearer token
TRIGGER_PROJECT_REF=         # Project ref from Trigger.dev dashboard (e.g., proj_xxxx)
```

Both platforms require you to create a project manually first (Hookdeck project, Trigger.dev project) and grab the API keys. There's no way around that initial step. But everything after that is scripted.

### Trigger.dev side: fully automatable

Trigger.dev's workflow is already code-first and well suited to this:

- **Project config:** `trigger.config.ts` at the repo root defines the project ref, task directories, retry settings, etc. This is checked into version control.
- **Task definitions:** TypeScript files in a `/trigger` directory. Each task is a file exporting a `task()` call. This is the code that runs on Trigger.dev's infrastructure.
- **Local dev:** `npx trigger.dev@latest dev` starts a local dev server that registers tasks with the Trigger.dev platform, watches for changes, and executes tasks locally. Tasks show up in the Trigger.dev dashboard immediately.
- **Deploy:** `npx trigger.dev@latest deploy` bundles and deploys tasks to Trigger.dev Cloud. One command, no manual steps. Supports `--env dev` / `--env prod` / `--env staging`.
- **Init (first time only):** `npx trigger.dev@latest init` scaffolds the config file and trigger directory. We'd run this once when setting up the repo, then check the result in.

So the Trigger.dev side of setup is just `npm install` + `npx trigger.dev@latest deploy` (for cloud). The task code, config, and directory structure are all in the repo. No separate resource creation step — tasks are registered as part of the deploy.

**Important ordering:** Trigger.dev tasks need to be deployed *before* Hookdeck destinations are created, because the Hookdeck destinations point to specific task trigger URLs (e.g., `.../tasks/handle-pr/trigger`). If the tasks don't exist yet on Trigger.dev, the URLs will return 404s. The setup script should deploy to Trigger.dev first, then create Hookdeck resources, then register the GitHub webhook.

For local development, `npx trigger.dev@latest dev` replaces the deploy step — it starts a local server that registers tasks with the platform in dev mode. Tasks run on your machine but appear in the Trigger.dev dashboard and can receive events.

### Hookdeck side: fully automatable via CLI

The Hookdeck CLI (`hookdeck gateway connection upsert`) is idempotent and supports every configuration option we need as flags. Key flags confirmed from the CLI reference:

**Source configuration:**
- `--source-name` — source name (creates inline if doesn't exist)
- `--source-type` — `GITHUB` enables built-in GitHub HMAC verification
- `--source-webhook-secret` — the shared secret for verification
- `--source-allowed-http-methods` — restrict to POST

**Destination configuration:**
- `--destination-name` — destination name (creates inline if doesn't exist)
- `--destination-type` — `HTTP`
- `--destination-url` — the Trigger.dev task trigger endpoint
- `--destination-auth-method` — `bearer`
- `--destination-bearer-token` — the `TRIGGER_SECRET_KEY`

**Rules (filters, transforms, retries):**
- `--rule-filter-headers` — JSON filter on request headers (for Pattern B)
- `--rule-transform-code` — inline transformation code (for creating new)
- `--rule-transform-name` — reference an existing transformation by name or ID (for sharing)
- `--rule-retry-count` — number of retry attempts
- `--rule-retry-strategy` — `linear` or `exponential`
- `--rules-file` — path to a JSON file containing the full rules array (for complex configs)

**Operational:**
- `--dry-run` — preview changes without applying
- `hookdeck ci --api-key $HOOKDECK_API_KEY` — authenticate non-interactively (for scripts/CI)

### Trigger.dev deploy (no separate script needed)

The Trigger.dev CLI already handles everything. `npx trigger.dev@latest deploy` reads the project ref from `trigger.config.ts`, authenticates via `TRIGGER_SECRET_KEY` from the environment, bundles the TypeScript task files, uploads them, and registers the tasks. No wrapper script needed.

This runs first in the setup flow because Hookdeck destinations point to specific task trigger URLs (e.g., `.../tasks/handle-pr/trigger`). Those endpoints need to exist before Hookdeck tries to deliver to them.

**Runtime environment variables:** The tasks themselves need `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` at runtime. Because tasks run on Trigger.dev's infrastructure (not locally), these need to be set in the Trigger.dev dashboard under Project Settings → Environment Variables, or synced via the `syncEnvVars` build extension. Worth investigating during the build whether `syncEnvVars` can pull from the `.env` file automatically.

### The Hookdeck setup script

The Hookdeck setup script (`scripts/setup-hookdeck.sh`) uses `hookdeck ci` for auth and `hookdeck gateway connection upsert` for idempotent resource creation. Because transformations can be created inline via `--rule-transform-code` or referenced by name via `--rule-transform-name`, we have two options:

**Option A: Inline transformation on every connection (simpler, self-contained):**

Each `connection upsert` includes the transformation code directly. Hookdeck will create the transformation if it doesn't exist and reuse it if the name matches. This keeps the script self-contained but means the transformation code is repeated in each command.

**Option B: Shared transformation referenced by name (cleaner, DRY):**

Create the transformation once (first connection creates it with `--rule-transform-code` and `--rule-transform-name`), then subsequent connections reference it with `--rule-transform-name` only. This is cleaner but depends on execution order.

**Recommended: Option B with a `--rules-file`** for the complex Pattern B connections.

### Draft setup script structure

```bash
#!/bin/bash
set -euo pipefail

# Load environment variables
source .env

echo "Authenticating with Hookdeck..."
hookdeck ci --api-key "$HOOKDECK_API_KEY"

TRIGGER_BASE_URL="https://api.trigger.dev/api/v1/tasks"

# Read transformation code from file
TRANSFORM_CODE=$(cat hookdeck/trigger-wrapper.js)

echo ""
echo "=== Pattern A: Single main task (fan-out) ==="

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
  --rule-retry-strategy linear

echo ""
echo "=== Pattern B: Hookdeck routes to per-event tasks ==="

# PR events
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
  --rule-retry-strategy linear

# Issue events
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
  --rule-retry-strategy linear

# Push events
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
  --rule-retry-strategy linear

echo ""
echo "Setup complete. Hookdeck source URL:"
hookdeck gateway source get github --output json | jq -r '.url'
echo ""
echo "Register this URL as your GitHub webhook endpoint."
```

### Proposed repo structure

See "Demo Task Design" section below for the final repo structure, which includes the GitHub webhook setup script and updated task files.

### What can't be automated

- **Creating the Hookdeck project itself.** The CLI manages resources within a project, but creating the project is done in the dashboard. The API key is per-project.
- **Creating the Trigger.dev project.** Same story — you create the project in the dashboard, then use the CLI for everything else.
- **Registering the GitHub webhook.** Automatable — see "GitHub Webhook Registration" section below.
- **Selecting which pattern to use.** Both patterns share the same source and transformation, so running the setup script creates resources for both. The user could comment out one pattern in the script if they only want one.

### npm scripts (package.json)

See "GitHub Webhook Registration" section below for the full updated scripts including `setup:github`.

### Things to validate during build

- Whether `--rule-transform-name` reuses an existing transformation by name (vs. creating a duplicate). The docs suggest `upsert` is idempotent, but this needs confirmation with transformations specifically.
- Whether `--source-type GITHUB` automatically configures HMAC verification using the `--source-webhook-secret`, or whether additional config flags are needed.
- Whether all connections can share the same source (the `upsert` command references sources by name, so the second call should find the existing source).
- The exact `--rule-filter-headers` JSON syntax — the filter operator might need to be lowercase `x-github-event` rather than `X-GitHub-Event` (headers are case-insensitive in HTTP but Hookdeck's filter matching may be case-sensitive).

### GitHub Webhook Registration

This can be automated with `gh api`. The `gh` CLI ships with authentication built in (the user runs `gh auth login` once), and the repos webhooks API lets you create webhooks programmatically:

```bash
#!/bin/bash
# scripts/setup-github-webhook.sh
set -euo pipefail

source .env

# Required: GITHUB_REPO (e.g., "hookdeck/trigger-dev-github-webhooks")
# Required: GITHUB_WEBHOOK_SECRET (same value used in Hookdeck source verification)
# Required: HOOKDECK_SOURCE_URL (output from setup-hookdeck.sh)

if [ -z "${GITHUB_REPO:-}" ]; then
  echo "Error: GITHUB_REPO not set (e.g., hookdeck/trigger-dev-github-webhooks)"
  exit 1
fi

if [ -z "${HOOKDECK_SOURCE_URL:-}" ]; then
  echo "Getting Hookdeck source URL..."
  HOOKDECK_SOURCE_URL=$(hookdeck gateway source get github --output json | jq -r '.url')
fi

echo "Creating GitHub webhook for $GITHUB_REPO..."
echo "  URL: $HOOKDECK_SOURCE_URL"
echo "  Events: pull_request, issues, push"

gh api "repos/$GITHUB_REPO/hooks" \
  --method POST \
  -f "name=web" \
  -f "config[url]=$HOOKDECK_SOURCE_URL" \
  -f "config[content_type]=json" \
  -f "config[secret]=$GITHUB_WEBHOOK_SECRET" \
  -f "events[]=pull_request" \
  -f "events[]=issues" \
  -f "events[]=push" \
  -f "active=true"

echo "GitHub webhook created successfully."
```

This means the full setup becomes: `npm run setup` (Hookdeck) then `npm run setup:github` (webhook registration). Or we combine them into a single `npm run setup` that runs both sequentially.

The updated npm scripts:

```json
{
  "scripts": {
    "setup": "npm run deploy && bash scripts/setup-hookdeck.sh && bash scripts/setup-github-webhook.sh",
    "setup:hookdeck": "bash scripts/setup-hookdeck.sh",
    "setup:github": "bash scripts/setup-github-webhook.sh",
    "setup:dry-run": "DRY_RUN=true bash scripts/setup-hookdeck.sh",
    "dev": "npx trigger.dev@latest dev",
    "deploy": "npx trigger.dev@latest deploy"
  }
}
```

The order matters: `deploy` first (so Trigger.dev task endpoints exist), Hookdeck resources second (destinations point to those endpoints), GitHub webhook last (source URL comes from Hookdeck).

**Prerequisites for GitHub automation:** The user needs `gh` installed and authenticated (`gh auth login`). The `.env` needs an additional `GITHUB_REPO` variable. This is a reasonable ask for a developer audience.

**Idempotency note:** The GitHub webhooks API doesn't have an upsert — calling it twice creates a duplicate webhook. The script should check for an existing webhook first and update it (using `PATCH /repos/{owner}/{repo}/hooks/{hook_id}`) or skip if one already exists pointing to the same URL. This is worth implementing for robustness but not essential for v1.

---

## Event Verification in Trigger.dev Tasks

### The problem

Trigger.dev tasks only receive the `payload` object — they don't have access to the HTTP headers from the incoming request. So the `x-hookdeck-verified` and `x-hookdeck-signature` headers that Hookdeck adds are consumed by the Trigger.dev API and never reach the task code.

This means the task has no way to verify the event came through Hookdeck unless we explicitly inject that information into the payload.

### The solution: transformation injects, task verifies

The `trigger-wrapper` transformation now injects a `_hookdeck` metadata object into the payload:

```javascript
// The transformation adds verification data from Hookdeck headers
payload: {
  _hookdeck: {
    verified: true,          // from x-hookdeck-verified header
    signature: "abc123...",  // from x-hookdeck-signature header
  },
  event: "pull_request",
  action: "opened",
  // ... rest of the GitHub webhook payload
}
```

The underscore prefix on `_hookdeck` signals it's metadata injected by the infrastructure, not part of the original GitHub payload.

### Reusable verification utility

Verification should be a shared utility function, not a task. Tasks call it synchronously before doing any processing:

```typescript
// trigger/lib/verify-hookdeck.ts

export interface HookdeckMeta {
  verified: boolean;
  signature?: string;
}

export function verifyHookdeckEvent(payload: { _hookdeck?: HookdeckMeta }): void {
  if (!payload._hookdeck) {
    throw new Error("Missing _hookdeck metadata — event did not come through Hookdeck");
  }

  if (!payload._hookdeck.verified) {
    throw new Error("Event failed Hookdeck source verification");
  }

  // Optionally: verify the signature against the Hookdeck project signing secret
  // This is defense-in-depth — the Bearer token on the destination already authenticates
  // the request to Trigger.dev, and verified:true confirms Hookdeck verified the source.
}
```

### Where verification runs depends on the pattern

**Pattern A (fan-out):** The router task (`github-webhook-handler`) verifies once. Sub-tasks trust the payload because they were triggered by the router, not by an external HTTP request.

```typescript
// Pattern A: verify once in the router
export const githubWebhookHandler = task({
  id: "github-webhook-handler",
  run: async (payload) => {
    verifyHookdeckEvent(payload);  // ← verify here, once

    switch (payload.event) {
      case "pull_request":
        await tasks.trigger("handle-pr", payload);  // sub-task trusts the payload
        break;
      // ...
    }
  },
});
```

**Pattern B (Hookdeck routing):** Each task receives events directly from Hookdeck via the Trigger.dev API, so each task must verify independently.

```typescript
// Pattern B: each task verifies independently
export const handlePR = task({
  id: "handle-pr",
  run: async (payload) => {
    verifyHookdeckEvent(payload);  // ← each task verifies

    // ... PR review logic
  },
});
```

This is a useful trade-off to highlight in the guide: Pattern A centralizes verification (and routing logic) in one place; Pattern B requires each task to handle it, but gives you independent observability and retry per event type.

### Defense in depth

The verification chain has three layers:

1. **Hookdeck source verification** — validates the GitHub HMAC signature (`X-Hub-Signature-256`) at ingress. Events that fail are rejected before they reach any connection.
2. **Trigger.dev destination auth** — the Bearer token (`TRIGGER_SECRET_KEY`) authenticates Hookdeck to the Trigger.dev API. Only requests with the correct token can trigger tasks.
3. **Task-level verification** — the `verifyHookdeckEvent()` check confirms the `_hookdeck.verified` flag is `true`, ensuring the event actually passed source verification (not just that someone had the Bearer token).

Layers 1 and 2 are handled by infrastructure. Layer 3 is the application-level check. The guide should be explicit about all three.

---

## Demo Task Design

The demo needs to do something real enough to be compelling, but simple enough that people can follow along and adapt it. The context doc notes that Trigger.dev's fastest-growing use case is AI coding agents triggered by GitHub webhooks — people running Claude Code inside Trigger.dev tasks. The demo should lean into that.

### Guiding principle

Each task should do one clear, useful thing that a developer would actually want automated. The tasks should be interesting enough to make someone think "I want to build something like this" but not so complex that they obscure the Hookdeck + Trigger.dev integration, which is the real point.

### Proposed tasks

**1. PR Code Review Summary (`handle-pr`)**

When a PR is opened or updated, generate a summary of the changes and post it as a PR comment. This is the showcase task — it demonstrates the AI agent use case that Trigger.dev is known for.

What it does:
- Receives a `pull_request` event (action: `opened`, `synchronize`)
- Fetches the PR diff using the GitHub API
- Sends the diff to an LLM (Claude via the Anthropic SDK or Vercel AI SDK) with a prompt like "Summarize the key changes in this PR and flag any potential issues"
- Posts the summary as a comment on the PR via the GitHub API

Why this works for the demo:
- It's the exact use case Trigger.dev highlights (AI agents triggered by GitHub events)
- It produces a visible result (a PR comment) that's easy to screenshot and put in the guide
- It's genuinely useful — many developers already use similar tools
- It shows why you'd want Hookdeck in the middle: verification, retry on LLM failures, observability

**2. Issue Labeler (`handle-issue`)**

When an issue is created, analyze the title and body and auto-apply labels.

What it does:
- Receives an `issues` event (action: `opened`)
- Reads the issue title and body
- Uses an LLM to classify it (bug, feature request, question, documentation)
- Applies the matching label(s) via the GitHub API

Why this works:
- Simple, focused, quick to execute
- Shows a different event type flowing through the same Hookdeck source
- Produces a visible result (label appears on the issue)
- Doesn't require fetching additional data (the payload has everything needed)

**3. Deployment Summary to Slack (`handle-push`)**

When code is pushed to the main branch, use an LLM to summarize what shipped and post it to a Slack channel.

What it does:
- Receives a `push` event
- Checks if the push is to the default branch (ignores feature branch pushes)
- Collects the commit messages and list of changed files from the payload
- Sends them to an LLM with a prompt like "Summarize what changed in this deployment in 2-3 sentences, suitable for a team Slack channel. Focus on what shipped, not the individual commits."
- Posts the summary to a Slack channel via the Slack Web API (or an incoming webhook URL)

Why this works:
- All three tasks now use an LLM, giving the demo a consistent "AI agent" feel
- Slack is a tangible, visible output that every developer relates to
- It's genuinely useful — teams often want a human-readable "what just shipped" message
- Shows a different integration surface (Slack) alongside the GitHub API interactions in the other tasks
- The push payload includes commit messages and file lists, so no extra API calls needed to gather context

### Pattern A fan-out version

For Pattern A, the single `github-webhook-handler` task receives all events and triggers the appropriate sub-task:

```typescript
import { task, tasks } from "@trigger.dev/sdk";
import { verifyHookdeckEvent } from "./lib/verify-hookdeck";

export const githubWebhookHandler = task({
  id: "github-webhook-handler",
  run: async (payload: {
    event: string;
    action?: string;
    [key: string]: unknown;
  }) => {
    verifyHookdeckEvent(payload);  // verify once — sub-tasks trust the payload

    switch (payload.event) {
      case "pull_request":
        if (payload.action === "opened" || payload.action === "synchronize") {
          await tasks.trigger("handle-pr", payload);
        }
        break;
      case "issues":
        if (payload.action === "opened") {
          await tasks.trigger("handle-issue", payload);
        }
        break;
      case "push":
        await tasks.trigger("handle-push", payload);
        break;
      default:
        console.log(`Ignoring event: ${payload.event}`);
    }
  },
});
```

This shows the fan-out pattern clearly: one entry point, routing in code, sub-tasks for each concern.

### What the tasks need

**GitHub API access:** The PR review and issue labeler tasks need a GitHub token with `repo` scope to fetch diffs and post comments/labels. This goes in `.env` as `GITHUB_ACCESS_TOKEN` (synced to Trigger on deploy). The `gh` CLI token can be reused, or the user creates a token in GitHub settings.

**LLM API access:** All three tasks use Claude for summarization/classification. This goes in `.env` as `ANTHROPIC_API_KEY`.

**Slack API access:** The deployment summary task posts to a Slack channel. Simplest approach is a Slack incoming webhook URL (no OAuth needed — just create one in the Slack app settings). This goes in `.env` as `SLACK_WEBHOOK_URL`. Alternatively, use a Slack bot token (`SLACK_BOT_TOKEN`) with `chat:write` scope for richer formatting.

**Updated `.env.example`:**

```bash
# Hookdeck
HOOKDECK_API_KEY=
GITHUB_WEBHOOK_SECRET=

# Trigger.dev
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_REF=

# GitHub (for tasks that interact with the GitHub API)
GITHUB_REPO=             # e.g., hookdeck/hookdeck-demos
GITHUB_ACCESS_TOKEN=     # GitHub API token with repo scope (synced to Trigger on deploy)

# AI (all tasks use Claude for summarization/classification)
ANTHROPIC_API_KEY=

# Slack (for deployment summary notifications)
SLACK_WEBHOOK_URL=       # Incoming webhook URL from Slack app settings
```

### Keeping it buildable

The tasks should use standard, well-documented libraries:
- `@anthropic-ai/sdk` or `ai` (Vercel AI SDK) for LLM calls
- `@octokit/rest` or raw `fetch` for GitHub API calls
- Raw `fetch` for Slack webhook posts (no SDK needed — it's a single POST)
- No heavy frameworks — just TypeScript files in the `/trigger` directory

Each task file should be self-contained and readable. Someone should be able to open `handle-pr.ts` and understand what it does without reading anything else.

### Location: `hookdeck/hookdeck-demos` repo

This demo lives at `trigger-dev/github-ai-agent/` in the [`hookdeck/hookdeck-demos`](https://github.com/hookdeck/hookdeck-demos) repo, following the `vendor/use-case/` convention established in Phase 0.

```
trigger-dev/github-ai-agent/
  .env.example
  package.json
  trigger.config.ts
  trigger/
    lib/
      verify-hookdeck.ts           # Shared verification utility
    github-webhook-handler.ts      # Pattern A: fan-out router (verifies here)
    handle-pr.ts                   # AI-powered PR review summary (verifies in Pattern B)
    handle-issue.ts                # AI-powered issue labeler (verifies in Pattern B)
    handle-push.ts                 # Deploy/push notification (verifies in Pattern B)
  hookdeck/
    trigger-wrapper.js
  scripts/
    setup-hookdeck.sh
    setup-github-webhook.sh
  README.md
```

Future Trigger.dev demos go alongside: `trigger-dev/stripe-background-jobs/`, etc.

---

## Open Items (Non-blocking)

- **Shared Slack channel:** Matt offered to create this. Check if it exists yet; if not, follow up.
- **GitHub repo for demo code:** Resolved — using `hookdeck/hookdeck-demos` under `trigger-dev/github-ai-agent/`.
- **Trigger.dev skills repo PR:** After guide is live, submit PR to `triggerdotdev/skills` pointing to the guide.
- **Newsletter timing:** Coordinate with Gareth on when to promote.
