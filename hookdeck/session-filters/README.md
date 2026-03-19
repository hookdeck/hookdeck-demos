# Hookdeck Session Filters Demo - GitHub Webhook Noise

This demo demonstrates how to filter webhook noise using Hookdeck session filters. It includes both a webhook receiver server and a webhook sender that simulates GitHub webhook events, allowing you to test filtering in action.

## Installation

```bash
npm install
```

## Prerequisites

- **Node.js** version 18 or higher
- **npm** for package management
- **tmux** - Terminal multiplexer (required for walkthrough automation)
  - macOS: `brew install tmux`
  - Linux: `apt-get install tmux` or `yum install tmux`

## Running the Webhook Receiver

Start the Express server to receive webhooks:

```bash
npm run server
```

**Server details:**
- **Port:** 3000 (default, configurable via `PORT` environment variable)
- **Webhook endpoint:** `http://localhost:3000/webhooks/github`
- **Output:** Logs each received event with timestamp, event type, and payload size

The server will display received webhooks in the format:
```
[HH:MM:SS] <- Received GitHub event: pull_request (1234 bytes)
```

## Sending GitHub Webhooks

Use the webhook sender to simulate GitHub webhook events:

```bash
npm run webhooks -- --url <url> [options]
```

### Required Parameters

- `--url <url>`: Target URL to POST webhooks to

### Optional Parameters

- `--owner <owner>`: Repository owner value (default: `hookdeck`)
- `--name <name>`: Repository name value (default: `cli-demo`)
- `--login <login>`: Sender login value (default: `demo-user`)
- `--secret <secret>`: Webhook secret for HMAC SHA-256 signing (default: none)
- `--sleep <seconds>`: Seconds to sleep between events (default: `1.25`)
- `--timeout <seconds>`: HTTP timeout for each request (default: `5.0`)
- `--ua <user-agent>`: User-Agent to send (default: `GitHub-Hookshot/000000`)
- `--loops <number>`: Number of times to repeat the webhook sequence (default: `1`, min: `1`)
- `--verbose`: Print per-request status
- `--help, -h`: Show help message

### Event Sequence

The script sends these GitHub webhook events in order:

1. `push` - Code pushed to demo/noise branch
2. `issues` (opened) - New issue #101 created
3. `pull_request` (opened) - New PR #7 created
4. `issue_comment` (created) - Comment added to PR #7
5. `pull_request` (labeled) - Label added to PR #7
6. `star` (created) - Repository starred
7. `pull_request` (closed) - PR #7 closed/merged
8. `issues` (closed) - Issue #101 closed

### Usage Examples

#### Basic usage (minimum required parameters)

```bash
npm run webhooks -- --url http://localhost:3000/webhooks/github
```

#### With multiple loops (16 webhooks total)

```bash
npm run webhooks -- --url http://localhost:3000/webhooks/github --loops 2
```

#### With webhook secret for HMAC signing

```bash
npm run webhooks -- --url http://localhost:3000/webhooks/github --secret whsec_mysecret
```

#### With verbose output

```bash
npm run webhooks -- --url https://events.hookdeck.com/e/src_abc123 --verbose
```

#### Combined options (3 loops, faster timing, verbose)

```bash
npm run webhooks -- --url http://localhost:3000/webhooks/github --loops 3 --sleep 0.5 --verbose
```

## Using with Hookdeck

Hookdeck allows you to filter webhook noise so only relevant events reach your local server.

### Install Hookdeck CLI

```bash
npm install -g @hookdeck/cli
```

### Noisy Stream (all events)

Without filters, all 8 webhook events reach your local server:

```bash
# Terminal 1: Start local server
npm run server

# Terminal 2: Start Hookdeck CLI (no filters)
hookdeck listen 3000 github

# Terminal 3: Send webhooks
npm run webhooks -- --url <HOOKDECK_URL>
```

**Result:** All 8 events are forwarded to your local server.

### Filtered Stream (only pull_request.opened)

With Hookdeck filters, only specific events reach your local server:

```bash
# Terminal 1: Start local server
npm run server

# Terminal 2: Start Hookdeck CLI with filters
hookdeck listen 3000 github \
  --filter-headers '{"x-github-event": "pull_request"}' \
  --filter-body '{"action": "opened"}'

# Terminal 3: Send webhooks
npm run webhooks -- --url <HOOKDECK_URL>
```

**Result:** Only 1 event (pull_request.opened) is forwarded to your local server. The other 7 events are filtered out by Hookdeck.

### Advanced Filtering Examples

#### Filter for specific event types

```bash
# Only issues events
hookdeck listen 3000 github \
  --filter-headers '{"x-github-event": "issues"}'
```

#### Filter for multiple criteria

```bash
# Only pull_request events that are closed
hookdeck listen 3000 github \
  --filter-headers '{"x-github-event": "pull_request"}' \
  --filter-body '{"action": "closed"}'
```

## Automated Walkthrough

Run an automated, interactive walkthrough that demonstrates the complete filtering workflow in a multi-pane terminal setup:

```bash
npm run walkthrough
```

This command uses the [tmux-presenter](../tmux-presenter) framework to orchestrate an automated demonstration. The walkthrough guides you through 4 scenes showing webhook noise filtering in action, with commands automatically executed in a 3-pane terminal layout.

**For details on:**
- The presentation configuration and scene definitions, see [`presentation.yaml`](./presentation.yaml)
- Step-by-step manual walkthrough instructions, see [`walkthrough.md`](./walkthrough.md)
- The available npm scripts, see [`package.json`](./package.json)

## Demo Workflow

Follow this step-by-step guide for a complete demo:

### 1. Start the Local Server

```bash
npm run server
```

You should see:
```
[HH:MM:SS] Server listening on port 3000
[HH:MM:SS] Webhook URL: http://localhost:3000/webhooks/github
```

### 2. Send Webhooks Directly (No Filtering)

In a new terminal, send webhooks directly to your local server:

```bash
npm run webhooks -- --url http://localhost:3000/webhooks/github --verbose
```

**Observe:** Your server logs all 8 events.

### 3. Start Hookdeck (Noisy Stream)

Stop the previous webhook sender and start Hookdeck without filters:

```bash
hookdeck listen 3000 github
```

Copy the Hookdeck URL provided (e.g., `https://events.hookdeck.com/e/src_abc123`).

### 4. Send Webhooks Through Hookdeck (No Filtering)

```bash
npm run webhooks -- --url <HOOKDECK_URL> --verbose
```

**Observe:** All 8 events pass through Hookdeck to your local server.

### 5. Apply Hookdeck Filters

Stop Hookdeck and restart with filters:

```bash
hookdeck listen 3000 github \
  --filter-headers '{"x-github-event": "pull_request"}' \
  --filter-body '{"action": "opened"}'
```

### 6. Send Webhooks Through Hookdeck (With Filtering)

```bash
npm run webhooks -- --url <HOOKDECK_URL> --verbose
```

**Observe:** Only 1 event (pull_request.opened) reaches your local server. The other 7 are filtered at the Hookdeck gateway.

### 7. Review Filtered Events in Hookdeck Dashboard

- Open the Hookdeck dashboard
- Navigate to **Events** → **Filtered**
- See all 7 filtered events and the criteria that excluded them

## Talking Points for Demo

- "I'm sending 8 different GitHub webhook events directly to my local server - notice all of them arrive."
- "Now I'll route them through Hookdeck without any filters - again, all 8 events reach my server."
- "Let me enable Hookdeck session filters to only allow pull_request.opened events."
- "When I send the same 8 events again, only 1 reaches my local server - the other 7 are filtered at the gateway."
- "This prevents webhook noise during local development and reduces unnecessary processing in production."
- "You can view all filtered events in the Hookdeck dashboard for debugging and observability."