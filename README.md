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
_shared/        Source of truth for code shared across demos
```

## Get one demo

Each demo is standalone. You do not need to clone this repo.

```bash
npx giget@latest gh:hookdeck/hookdeck-demos/<vendor>/<demo> my-demo
cd my-demo && npm install
```

For example, `npx giget@latest gh:hookdeck/hookdeck-demos/deepgram/stt-tts my-demo`. Prefer git? Clone the repo and `cd <vendor>/<demo>`. Each demo's README has its setup steps.

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
| [mcp-events-forward-proxy](hookdeck/mcp-events-forward-proxy/) | Receive MCP Events through Event Gateway acting as the agent's forward proxy: challenge, verification, dedup and retries, locally with `hookdeck listen` or deployed over HTTP |
| [mcp-events-outpost](hookdeck/mcp-events-outpost/) | Send MCP Events from an MCP server with Hookdeck Outpost's native MCP Events support, which runs the subscriptions and delivers each event (links to [hookdeck/mcp-events-outpost-demo](https://github.com/hookdeck/mcp-events-outpost-demo)) |
| [session-filters](hookdeck/session-filters/) | CLI session filters demo |
| [transformations](hookdeck/transformations/) | Transformations that import Node.js built-ins (`node:zlib`, `node:crypto`, `node:buffer`) to turn JSON events into a PNG, WAV, PDF or SVG, sign requests, and decompress binary payloads, with a UI that follows each event from source to result |
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
| [ds](_shared/ds/) | Hookdeck design system: tokens, styles and brand assets (copied into demos, see Shared code) |
| [hookdeck](_shared/hookdeck/) | Hookdeck CLI helper and `hookdeck listen` wrapper (TypeScript) |
| [tmux-presenter](_shared/tmux-presenter/) | Tmux-based live demo presenter for running scripted terminal demos |

## Shared code

Some code is the same in several demos: the Hookdeck design system (`ds/`) and the Hookdeck CLI helpers (`scripts/hookdeck-cli.ts`, `scripts/hookdeck-listen.ts`). So a demo still works when downloaded alone, each demo holds a real copy of what it uses. The source of truth is `_shared/`.

- **Edit in `_shared/` only.** Copies carry a "Generated from" header (directories also have a `GENERATED.md`), so an edit in the wrong place is easy to spot in review.
- **`_shared/manifest.json`** lists which demo takes which piece and where it goes inside the demo. A demo not listed for a piece may own its own copy.
- **`npm run sync-shared`** (from the repo root, Node 22) copies the pieces into the demos. `npm run sync-shared -- --check` changes nothing, prints the files that differ and exits non-zero if any do.
- **CI** (`.github/workflows/shared.yml`) runs `--check` on every pull request and push to `main`. It also copies each demo in the manifest to an empty folder on its own, runs `npm ci` (or `npm install`) and the demo's `typecheck` script if it has one.

To add a demo to a piece, add it to `demos` in the manifest and run `npm run sync-shared`.

## Contributing

Each demo has its own README with setup instructions. See the individual demo directories for details.
