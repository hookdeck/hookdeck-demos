# Hookdeck Demos

Demo code for [Hookdeck](https://hookdeck.com), organized by vendor and use case.

## Directory Structure

Demos follow a `vendor/use-case/` convention. Hookdeck itself is treated as a vendor for feature demos.

```
hookdeck/       Hookdeck feature demos
trigger-dev/    Trigger.dev integration demos
stripe/         Stripe integration demos
shopify/        Shopify integration demos
deepgram/       Deepgram integration demos
_shared/        Shared utilities used across demos
```

## Demos

### Hookdeck

| Demo | Description |
|------|-------------|
| [binary-payloads](hookdeck/binary-payloads/) | Send audio, video, images, archives, PDFs and binary serialization formats through a source to `hookdeck listen`, and check which content types arrive byte-exact |
| [cli-fleet-fanout](hookdeck/cli-fleet-fanout/) | Fan out webhooks to a fleet of machines on a private network with CLI destinations: connection-per-machine vs connection-per-group |
| [cli-overview](hookdeck/cli-overview/) | Overview of the Hookdeck CLI capabilities |
| [deduplication](hookdeck/deduplication/) | Event deduplication with payload-based and ID-based modes |
| [demo-scripts](hookdeck/demo-scripts/) | Scripts for automating demo setup and event triggering |
| [general](hookdeck/general/) | Next.js app for receiving and verifying webhooks from multiple providers |
| [mcp-events-outpost](hookdeck/mcp-events-outpost/) | Send MCP Events from an MCP server with Hookdeck Outpost (links to [hookdeck/mcp-events-outpost-demo](https://github.com/hookdeck/mcp-events-outpost-demo)) |
| [mcp-events-receive](hookdeck/mcp-events-receive/) | Receive MCP Events through Event Gateway acting as the agent's forward proxy: challenge, verification, dedup and retries, locally with `hookdeck listen` or deployed over HTTP (work in progress) |
| [session-filters](hookdeck/session-filters/) | CLI session filters demo |
| [transformation-reordering](hookdeck/transformation-reordering/) | Transformation and filter rule reordering |

### Trigger.dev

| Demo | Description |
|------|-------------|
| [github-ai-agent](trigger-dev/github-ai-agent/) | GitHub webhooks → Hookdeck → Trigger.dev: Claude PR reviews, issue labels, push summaries (task router vs Hookdeck routing) |

### Stripe

| Demo | Description |
|------|-------------|
| [fetch-before-process](stripe/fetch-before-process/) | Express.js app demonstrating the fetch-before-process webhook pattern |

### Shopify

| Demo | Description |
|------|-------------|
| [webhooks-at-scale](shopify/webhooks-at-scale/) | Complete Shopify app demo: setup, backpressure handling, and retry workflows |

### Deepgram

| Demo | Description |
|------|-------------|
| [stt-tts](deepgram/stt-tts/) | Deepgram callbacks through Hookdeck: speech-to-text as JSON, and text-to-speech as binary `audio/mpeg` |

## Shared Utilities

| Utility | Description |
|---------|-------------|
| [tmux-presenter](_shared/tmux-presenter/) | Tmux-based live demo presenter for running scripted terminal demos |

## Contributing

Each demo has its own README with setup instructions. See the individual demo directories for details.
