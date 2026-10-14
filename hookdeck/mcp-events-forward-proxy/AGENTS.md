# AGENTS.md

Context for agents continuing this demo. Read `docs/PLAN.md` first (its Status section says what's built, what's verified and what's next), then `README.md`. Don't duplicate them here; update them when behavior changes.

## What this is

A demo of Hookdeck Event Gateway acting as the MCP Events "forward proxy" from SEP-3415: an agent subscribes to an MCP server with an Event Gateway `MCP Events` source as its callback URL, and Event Gateway answers the verification challenge, verifies, dedupes, stores and delivers to the agent. The sending side with Hookdeck Outpost is a separate repo: [hookdeck/mcp-events-outpost-demo](https://github.com/hookdeck/mcp-events-outpost-demo).

## Design decisions (keep unless there's a reason)

- **The client owns the proxy.** The agent creates one `MCP Events` source per subscription with that subscription's secret, then subscribes with the source URL. The SEP doesn't define the client-to-proxy step, so it lives only in `src/agent/proxy.ts`.
- **Event Gateway is driven through the REST API** (`src/agent/hookdeck.ts`), not the CLI, so per-subscription secrets never appear on a command line. The CLI is used only for `hookdeck listen`.
- **Local development uses `hookdeck listen` (CLI destination); the HTTP destination is tested deployed** on Fly.io. No third-party tunnels.
- **The stand-in sender follows OpenAI's MCP Events profile** (top-level `capabilities.events`, `-32015`, idempotent unsubscribe). SEP-3415 differs; note differences rather than switching.
- **Recovery uses request retry, never replay,** and retries an event only once it's settled (`next_attempt_at` null). Both rules prevent duplicate deliveries; see Phase 2 in `docs/PLAN.md`.
- **The agent re-checks the MCP server's signature without the 5-minute window,** because Event Gateway delivers the stored request with its original `webhook-timestamp`. In HTTP mode it also checks `x-hookdeck-signature`.

## Working conventions

- TypeScript, ESM, Node 22+. `npm run typecheck` must pass before committing. There are no unit tests; verification is by running the flows against a test project and recording results in `docs/PLAN.md`.
- `.env` holds a real Event Gateway API key and signing secret. Don't print or commit it. Use a dedicated test project: the agent creates and deletes resources by name prefix (`AGENT_NAME`).
- **Ask the user before** pushing, opening a PR, deploying, starting any tunnel, or running against a project other than the test project.
- This repo is public: name no individuals, link no private repos or internal tools, and keep plans standalone. Call other products alternatives, not competitors.
- Writing: American English, developer to developer, no hype, short paragraphs, no em dashes, no horizontal rules. Don't write "app" or "apps" for MCP servers or agents. Write "ID" in prose. Render changed Mermaid diagrams before committing (`npx -y @mermaid-js/mermaid-cli -i x.mmd -o x.svg`).
- Small, focused commits on a branch.

## Environment gotchas

- npm may hold back esbuild's install script; tsx works without it.
- `hookdeck listen` runs the CLI binary from `node_modules/hookdeck-cli/binaries/`, not the `.bin` wrapper, so SIGINT reaches it. Other `hookdeck listen` processes on the machine may belong to other projects; leave them alone.
- Ctrl+C can deliver SIGINT several times; the agent's shutdown runs once.
- The agent owns resources named `<AGENT_NAME>-<8 hex>` and matches that exactly. The deployed agent uses `AGENT_NAME=mcp-events-agent-fly` in the same test project, so a looser prefix match from a local agent deletes the deployed agent's source (it happened once).
- Event Gateway answers `200` to a badly signed delivery and rejects it afterwards as `VERIFICATION_FAILED`. Check outcomes in the request log, not by status code.
