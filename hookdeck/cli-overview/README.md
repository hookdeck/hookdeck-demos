# Hookdeck CLI Guest Mode Demo

This demo showcases the Hookdeck CLI's guest mode functionality, allowing developers to test and debug webhook integrations locally with **no account or authentication required**. The demo walks through receiving Shopify-style webhooks, navigating the interactive TUI, inspecting event details, retrying deliveries, and filtering webhook noise.

## Installation

```bash
npm install
```

## Prerequisites

- **Node.js** version 18 or higher
- **npm** for package management
- **tmux** - Terminal multiplexer (required for automated walkthrough)
  - macOS: `brew install tmux`
  - Linux: `apt-get install tmux` or `yum install tmux`
- **Hookdeck CLI** - Install globally: `npm install -g @hookdeck/cli`
- **curl** - Standard on macOS/Linux for sending test webhooks

## Running the Automated Walkthrough

```bash
npm run walkthrough
```

This command uses the [tmux-presenter](../../_shared/tmux-presenter) framework to orchestrate an automated demonstration. The walkthrough guides you through 10 scenes showing the CLI's guest mode capabilities in a multi-pane terminal setup.

**Walkthrough details:**
- **Duration:** ~3 minutes
- **Scenes:** 10 interactive scenes
- **Features demonstrated:** Guest mode, TUI navigation, event inspection, retries, session filters
- **Configuration:** See [`presentation.yaml`](./presentation.yaml) for scene definitions

The automated walkthrough uses `--config .hookdeck-guest-config.toml` to ensure the demo runs in guest mode even if you're logged into Hookdeck.

## Running Components Manually

### Start the Local Server

```bash
npm run server
```

**Server details:**
- **Port:** 3000 (default, configurable via `PORT` environment variable)
- **Webhook endpoint:** `http://localhost:3000/webhooks/shopify`
- **Output:** Logs each received webhook with timestamp, topic, and payload size

The server will display received webhooks in the format:
```
[HH:MM:SS] <- Received Shopify webhook: orders/create (123 bytes)
```

### Start Hookdeck CLI (Guest Mode)

```bash
hookdeck listen 3000 shopify --path /webhooks/shopify --config .hookdeck-guest-config.toml
```

**⚠️ CRITICAL:** The `--config .hookdeck-guest-config.toml` flag is essential for this demo. It ensures the CLI runs in guest mode by pointing to a non-existent config file, preventing it from using your default credentials at `$HOME/.config/hookdeck/config.toml`.

**What happens in guest mode:**
- ✅ **No login required** - Start immediately without authentication
- ✅ **Unique event URL** - Receive a permanent URL like `https://hkdk.events/xxxxxxxxxxxx`
- ✅ **Interactive TUI** - View incoming events in real-time with a terminal UI
- ✅ **Full functionality** - Inspect, retry, and filter events just like authenticated mode

Copy the provided Hookdeck URL (e.g., `https://hkdk.events/xxxxxxxxxxxx`) to use in the next step.

### Send Test Events

Replace `https://hkdk.events/xxxxxxxxxxxx` with your actual Hookdeck URL from the previous step:

```bash
# Order created event
curl -X POST https://hkdk.events/xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/create" \
  -d '{"id":1001,"email":"alice@example.com","total_price":"29.99"}'

# Product updated event
curl -X POST https://hkdk.events/xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: products/update" \
  -d '{"id":2002,"title":"T-shirt","variants":[{"id":1,"price":"19.99"}]}'

# Inventory level updated event
curl -X POST https://hkdk.events/xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: inventory_levels/update" \
  -d '{"inventory_item_id":3003,"available":42}'
```

**Expected result:** All three events appear instantly in the Hookdeck TUI and are forwarded to your local server at `http://localhost:3000/webhooks/shopify`.

## Using Session Filters

Session filters allow you to focus on specific webhook events during development, reducing noise from irrelevant events.

### Filter by Event Type

To receive only `orders/create` events:

```bash
hookdeck listen 3000 shopify --path /webhooks/shopify \
  --config .hookdeck-guest-config.toml \
  --filter-headers '{"X-Shopify-Topic": "orders/create"}'
```

Send all three curl commands again. Only the `orders/create` event will reach your local server - the other two will be filtered at the Hookdeck gateway.

### Filter by Multiple Criteria

You can combine header and body filters:

```bash
hookdeck listen 3000 shopify --path /webhooks/shopify \
  --config .hookdeck-guest-config.toml \
  --filter-headers '{"X-Shopify-Topic": "orders/create"}' \
  --filter-body '{"total_price": "29.99"}'
```

Only events matching **both** the header and body criteria will be forwarded.

## Interactive TUI Features

The Hookdeck CLI includes a powerful Terminal User Interface (TUI) for managing webhook events:

### Navigation
- **↑ ↓** - Arrow keys to navigate between events
- **q** - Quit the CLI session

### Event Inspection
- **d** - Open detailed view of the selected event
  - View complete headers, request body, and response
  - Scroll through large payloads
- **ESC** - Return to event list from detail view

### Event Management
- **r** - Retry/replay the selected event to your local server
  - Useful for testing error handling and recovery
- **o** - Open the selected event in the Hookdeck dashboard (requires login)

### Status Indicators
- ✅ **Green checkmark** - Event successfully delivered
- ❌ **Red X** - Event delivery failed (e.g., server unreachable)
- **Timestamp** - When the event was received
- **Headers** - Quick view of important headers like `X-Shopify-Topic`

## Demo Workflow

For a complete demonstration of this project's capabilities:

1. **Automated presentation** - Run `npm run walkthrough` for a guided tmux-based demo
2. **Manual video script** - See [`walkthrough.md`](./walkthrough.md) for a 10-scene video production plan with timing and talking points

The walkthrough demonstrates the complete flow: starting the server, launching CLI in guest mode, sending test events, navigating the TUI, inspecting events, retrying deliveries, and applying filters.

## Why Guest Mode Configuration?

The `--config .hookdeck-guest-config.toml` flag is critical for this demo because:

1. **Points to a non-existent config file** - The file `.hookdeck-guest-config.toml` doesn't exist and doesn't need to
2. **Bypasses default credentials** - Prevents the CLI from using `$HOME/.config/hookdeck/config.toml` where your login credentials are stored
3. **Ensures guest mode** - Forces the CLI to run in guest mode even if you're logged into Hookdeck
4. **Demo consistency** - Guarantees the demo behaves the same way whether you're logged in or not

Without this flag, if you're already logged into Hookdeck, the CLI would use your authenticated account, which changes the behavior and makes the demo less clear for showcasing guest mode capabilities.

## Talking Points for Demo

- "The Hookdeck CLI works instantly in guest mode — no account or setup required."
- "You get a permanent event URL for the session, unlike expiring tunnels."
- "The TUI provides real-time visibility into every webhook event with navigation, inspection, and replay."
- "Session filters cut through webhook noise during local development."
- "You can test error handling by replaying events without re-triggering the source."
- "Login is optional — guest mode is fully functional. Login adds persistence and team workflows."

## Project Structure

```
cli-overview/
├── src/
│   └── server.ts              # Local webhook receiver (Express server)
├── presentation.yaml           # tmux-presenter configuration
├── walkthrough.md             # Video production plan (10 scenes)
├── PROJECT_PLAN.md            # Implementation plan and phases
├── package.json               # npm scripts and dependencies
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

**Note:** `.hookdeck-guest-config.toml` is intentionally NOT in the repository — it should not exist, which is exactly how we force guest mode.

## Key Features Demonstrated

### 1. Guest Mode (No Authentication)
- Start the CLI instantly without creating an account
- Receive a unique, permanent event URL (`https://hkdk.events/...`)
- Full TUI functionality without login

### 2. Permanent Event URLs
- Unlike tunnels that expire, `hkdk.events` URLs persist for the session
- Shareable URLs for testing with external services
- No need to update webhook URLs when restarting

### 3. Interactive TUI Navigation
- Real-time event list with status indicators
- Arrow key navigation between events
- Detailed view with full headers and payloads

### 4. Session Filters
- Filter by headers (e.g., `X-Shopify-Topic`)
- Filter by body content (e.g., specific order amounts)
- Combine multiple filter criteria
- Reduces webhook noise during focused development

### 5. Event Inspection and Replay
- View complete request and response details
- Inspect headers, body, and metadata
- Retry events to test error handling
- No need to re-trigger the original webhook source

### 6. Error Recovery
- See failed deliveries clearly marked in the TUI
- Retry failed events after fixing local issues
- Test connection refused, timeouts, and other error scenarios

## Additional Resources

- **Automated walkthrough configuration:** [`presentation.yaml`](./presentation.yaml)
- **Manual step-by-step guide:** [`walkthrough.md`](./walkthrough.md)
- **tmux-presenter framework:** [`../../_shared/tmux-presenter/README.md`](../../_shared/tmux-presenter/README.md)
- **Hookdeck CLI documentation:** [https://hookdeck.com/docs/cli](https://hookdeck.com/docs/cli)
- **npm scripts:** See [`package.json`](./package.json) for available commands

## Troubleshooting

### CLI doesn't start in guest mode
- Ensure you're using the `--config .hookdeck-guest-config.toml` flag
- This file should NOT exist - that's intentional
- If it exists, delete it: `rm .hookdeck-guest-config.toml`

### Events not appearing in TUI
- Verify your local server is running (`npm run server`)
- Check you're using the correct `hkdk.events` URL from the CLI output
- Ensure the `X-Shopify-Topic` header is included in curl commands

### Local server not receiving events
- Confirm the Hookdeck CLI is running and shows "Connected"
- Check the path matches: `/webhooks/shopify` in both CLI and curl
- Try restarting the Hookdeck CLI session

### Filters not working
- Verify JSON syntax in filter parameters (use single quotes around JSON)
- Check header names match exactly (case-sensitive)
- Ensure the filter criteria match the webhook data structure