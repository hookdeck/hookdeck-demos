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

1. **Deploys Trigger.dev tasks** — bundles and uploads task code to Trigger.dev Cloud
2. **Creates Hookdeck resources** — source, destinations, connections, filters, and transformation (idempotent)
3. **Registers GitHub webhook** — points the webhook at the Hookdeck source URL

### Environment variables

**For setup scripts** (used locally):

| Variable | Description |
|----------|-------------|
| `HOOKDECK_API_KEY` | Hookdeck project API key |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for GitHub HMAC verification |
| `TRIGGER_SECRET_KEY` | Trigger.dev project secret key |
| `TRIGGER_PROJECT_REF` | Trigger.dev project ref |
| `GITHUB_REPO` | Target repo (e.g., `hookdeck/hookdeck-demos`) |

**For task runtime** (set in Trigger.dev dashboard under Environment Variables):

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Fine-grained PAT with repo scope |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |

## Local development

```bash
npm run dev
```

This starts the Trigger.dev dev server. Tasks run on your machine but appear in the Trigger.dev dashboard. Push events to your Hookdeck source URL to trigger them.

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
