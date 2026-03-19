# GitHub AI Agent: Hookdeck + Trigger.dev

AI-powered GitHub automation using Hookdeck for webhook routing and Trigger.dev for task execution. This demo shows two integration patterns with three real tasks.

## What it does

GitHub webhooks flow through Hookdeck (verification, routing, transformation) into Trigger.dev tasks that use Claude to automate developer workflows:

- **PR review summary** — when a PR is opened, fetches the diff, generates a code review summary with Claude, and posts it as a PR comment
- **Issue labeler** — when an issue is created, classifies it with Claude and auto-applies labels (bug, feature, question, documentation)
- **Deployment summary** — when code is pushed to main, summarizes what shipped with Claude and posts to Slack

## Two patterns

The demo shows two ways to connect Hookdeck to Trigger.dev:

**Pattern A (fan-out):** A single Hookdeck connection routes all GitHub events to one Trigger.dev task (`github-webhook-handler`), which verifies the event and fans out to sub-tasks based on event type. Simpler to set up, routing logic lives in code.

**Pattern B (Hookdeck routing):** Separate Hookdeck connections with header-based filter rules route each event type to a dedicated Trigger.dev task. Each task verifies independently. More Hookdeck resources, but each event type gets its own observability, retry policy, and filtering.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Hookdeck CLI](https://hookdeck.com/docs/cli) v1.2.0+
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- A [Trigger.dev](https://trigger.dev) account and project
- A [Hookdeck](https://hookdeck.com) account and project
- An [Anthropic](https://console.anthropic.com) API key
- A [Slack incoming webhook URL](https://api.slack.com/messaging/webhooks) (for deployment notifications)

## Setup

```bash
cp .env.example .env
# Fill in all values (see .env.example for descriptions)

npm install
npm run setup
```

`npm run setup` does three things in order:

1. **Deploys Trigger.dev tasks to Production** — `npm run deploy:prod` (explicit `--env prod`)
2. **Creates Hookdeck resources** — source, destinations, connections, filters, and transformation (idempotent)
3. **Registers GitHub webhook** — points the webhook at the Hookdeck source URL

### Trigger.dev (Production only)

This demo is wired for **Trigger.dev Production** only:

- **`TRIGGER_SECRET_KEY`** must be your **Production** API key (`tr_prod_…`). Hookdeck destinations use it as the Bearer token, so HTTP triggers always hit Production workers.
- **`npm run setup`** and **`npm run deploy`** run **`trigger.dev deploy --env prod`**.

Task runtime secrets are **synced from your local `.env` to Trigger.dev Production on every `npm run deploy`** (see `trigger.config.ts` → `syncEnvVars`): `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, and optional `GITHUB_LABELS`, `SLACK_WEBHOOK_URL`. Use the **same variable names** in `.env` and in the Trigger dashboard. If you still have an old `GITHUB_TOKEN` line only, deploy copies it to `GITHUB_ACCESS_TOKEN` for sync — rename when convenient.

**Why `GITHUB_ACCESS_TOKEN` and not `GITHUB_TOKEN`?** Many tools use `GITHUB_TOKEN`, but that name is special in GitHub Actions and some cloud UIs don’t persist it reliably. `GITHUB_ACCESS_TOKEN` is explicit and syncs cleanly.

If you previously used `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env`, rename that line to `GITHUB_ACCESS_TOKEN` and redeploy.

**Dashboard:** open **Production** (not Development) when checking vars.

### Environment variables

**For setup scripts** (used locally):

| Variable | Description |
|----------|-------------|
| `HOOKDECK_API_KEY` | Hookdeck project API key |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for GitHub HMAC verification |
| `TRIGGER_SECRET_KEY` | Trigger.dev **Production** secret (`tr_prod_…` only) |
| `TRIGGER_PROJECT_REF` | Trigger.dev project ref |
| `GITHUB_REPO` | Target repo (e.g., `hookdeck/hookdeck-demos`) |

**For task runtime** (keep in `.env` — **synced to Production on `npm run deploy`**, or set in the Trigger.dev dashboard):

| Variable | Description |
|----------|-------------|
| `GITHUB_ACCESS_TOKEN` | GitHub API token with `repo` scope (**required** in `.env`; synced on deploy) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude (**required** for deploy sync) |
| `GITHUB_LABELS` | Optional CSV of allowed issue labels |
| `SLACK_WEBHOOK_URL` | Optional Slack incoming webhook URL |
| `GITHUB_PUSH_SUMMARY_DEFAULT_BRANCH_ONLY` | Optional. If `true`, **`handle-push`** only runs for the repo’s default branch (`main`). **Default:** unset / `false` — **any branch** gets a Slack summary (easier for demos). |

## Deploying task changes

After editing files under `trigger/`, push new code to Trigger.dev Production:

```bash
npm run deploy
```

This also **re-syncs** the task env vars listed in `trigger.config.ts` from `.env` (so updating an API key locally and redeploying updates Production). `deploy:prod` passes **`--env-file .env`** so the deploy CLI loads your file before `syncEnvVars` runs. During deploy, Trigger prints **`Found N env vars to sync`** — `N` should match how many keys you’re syncing (typically **4** if `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, `GITHUB_LABELS`, and `SLACK_WEBHOOK_URL` are all set).

**CI:** use `npm run deploy:prod:ci` and export `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, etc. as job secrets instead of `--env-file`.

Then re-run Hooks or events as needed; Hookdeck continues to call the same task URLs.

## Project structure

```
trigger.config.ts              Trigger.dev project configuration
trigger/
  lib/
    ai.ts                      Claude helper (Anthropic SDK)
    github.ts                  GitHub API helpers (fetch-based)
    slack.ts                   Slack incoming webhook helper
    verify-hookdeck.ts         Event verification utility
  github-webhook-handler.ts    Pattern A: fan-out router
  handle-pr.ts                 PR code review summary
  handle-issue.ts              Issue labeler
  handle-push.ts               Deployment summary to Slack
hookdeck/
  trigger-wrapper.js           Shared Hookdeck transformation
scripts/
  setup-hookdeck.sh            Hookdeck resource creation (idempotent)
  setup-github-webhook.sh      GitHub webhook registration
```

## Verification chain

Events are verified at three levels:

1. **Hookdeck source verification** — validates the GitHub HMAC signature (`X-Hub-Signature-256`) at ingress
2. **Trigger.dev destination auth** — Bearer token authenticates Hookdeck to the Trigger.dev API
3. **Task-level verification** — `verifyHookdeckEvent()` confirms the `_hookdeck.verified` flag injected by the transformation

In Pattern A, verification happens once in the router task. In Pattern B, each task verifies independently.

## TODO

- [ ] **Architecture diagrams:** Add Mermaid diagrams to this README illustrating **Pattern A** (single Hookdeck connection → `github-webhook-handler` → fan-out to sub-tasks) vs **Pattern B** (separate filtered connections per event type → dedicated Trigger.dev tasks). Not implemented yet.
- [ ] **Hookdeck source verification:** Revisit event-source verification end-to-end (e.g. `x-hookdeck-verified` vs transform-time `context.connection.source.verification`, `_hookdeck.verified` semantics, and docs alignment). See `hookdeck/trigger-wrapper.js` and `trigger/lib/verify-hookdeck.ts`.
- [ ] **Development environment & prod parity:** Explore what a **dev** setup would look like (Trigger.dev Development + `trigger dev`, Hookdeck project or connections, webhook routing), how to **migrate or promote** to Production, and how to keep a dev stack **effectively matching prod** (env vars, connection names, transformation code, secrets rotation). This demo is Production-only today; document or script an optional path if we add it later.
