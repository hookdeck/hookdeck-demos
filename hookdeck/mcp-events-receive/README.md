# Receive MCP Events with Event Gateway as a forward proxy

> Work in progress. The flows below are built and verified; the scenarios script, recovery after `listen` downtime and the write-up aren't finished. See [docs/PLAN.md](docs/PLAN.md) for the full proposal, status and remaining work.

[MCP Events](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415) (SEP-3415, a draft MCP extension) lets an agent subscribe to events an MCP server offers. In webhook mode the server POSTs each event to a callback URL the agent chose. The SEP describes a common deployment where that URL belongs to a **forward proxy** that receives webhooks on the agent's behalf.

This demo uses Hookdeck Event Gateway as that proxy:

```mermaid
flowchart LR
    SRV["MCP server<br>(stand-in sender)"]
    subgraph EG["Hookdeck Event Gateway: the forward proxy"]
        SRC["MCP Events source<br>challenge, signature check, store"]
        CON["Connection<br>dedup on headers.webhook-id, retries"]
        SRC --> CON
    end
    AG["Agent<br>MCP client + event endpoint"]
    AG -- "1. create source with whsec_ secret" --> SRC
    AG -- "2. events/subscribe, url = source URL" --> SRV
    SRV -- "3. challenge, then signed events" --> SRC
    CON -- "4. deliver: hookdeck listen locally,<br>or HTTP when deployed" --> AG
```

1. **The agent owns the proxy.** For each subscription it creates an `MCP Events` source holding a fresh `whsec_` secret, plus a connection to itself with a deduplicate rule on `headers.webhook-id` and a retry rule.
2. **It subscribes with the source URL** as its callback. The MCP server doesn't know there's a proxy.
3. **Event Gateway answers the verification challenge** and verifies every delivery's Standard Webhooks signature. It stores each request before answering `200`, so the MCP server never sees the agent's downtime as delivery failures.
4. **Event Gateway delivers to the agent:** through `hookdeck listen` on localhost, or over HTTP to a deployed agent. It retries while the agent is down.

The agent refreshes its subscription before it expires, and on exit unsubscribes and deletes its source and connection.

## What's in here

| Path | What it is |
|---|---|
| `src/sender/` | A stand-in MCP server that sends MCP Events (`incident.created`). It plays the part of any third-party MCP server. For a production-grade sender, see [hookdeck/mcp-events-outpost-demo](https://github.com/hookdeck/mcp-events-outpost-demo). |
| `src/agent/` | The agent: an MCP client plus the event endpoint Event Gateway delivers to. `proxy.ts` is the only code that talks to Event Gateway. |
| `scripts/` | Open incidents, inspect or break the agent, clean up. |
| `docs/PLAN.md` | The proposal: background on the SEP, who does what, design decisions, status and remaining work. |

## Run it locally

Prerequisites: Node.js 22 or later, and a **dedicated** Event Gateway project (the agent creates and deletes sources and connections in it).

```bash
npm install
cp .env.example .env   # add HOOKDECK_API_KEY; set SENDER_TOKEN and AGENT_TOKEN to random strings
```

In one terminal, start the stand-in sender:

```bash
npm run sender
```

In a second terminal, start the agent. With no `AGENT_PUBLIC_URL`, it receives through `hookdeck listen` (the CLI is a dependency, logged in with its own config under `run/`):

```bash
npm run agent
```

The agent logs the source it created, `hookdeck listen` connecting, and the subscription. The sender logs the challenge being answered by Event Gateway.

In a third terminal:

```bash
npm run emit -- --severity P1 --title "Database connection pool exhausted"
npm run emit -- --duplicate        # same webhook-id twice, re-signed: handled once
npm run emit -- --bad-signature    # rejected by Event Gateway, never reaches the agent
npm run agent:fail                 # the agent answers 503 to every delivery
npm run emit                       # Event Gateway holds the event and retries
npm run agent:fail -- --off        # delivered on the next retry
npm run agent:status               # subscription, counters, handled events
```

To run every scenario and get pass or fail with evidence (the subscription, a delivery, a duplicate, a bad signature, the agent down then back, and, when deployed, a forged request refused):

```bash
npm run scenarios
```

Press Ctrl+C in the agent's terminal to unsubscribe and delete its source and connection. If an agent was killed without cleaning up, `npm run teardown` removes what it left.

## Deploy to Fly.io

The deployed agent receives over HTTP at its public URL, and checks Event Gateway's `x-hookdeck-signature` with the project's signing secret.

```bash
fly apps create <sender-app> && fly apps create <agent-app>   # then set the app names and URLs in fly.*.toml
fly secrets set -c fly.sender.toml SENDER_TOKEN=...
fly secrets set -c fly.agent.toml HOOKDECK_API_KEY=... HOOKDECK_SIGNING_SECRET=... AGENT_TOKEN=... SENDER_TOKEN=...
fly deploy -c fly.sender.toml --ha=false
fly deploy -c fly.agent.toml --ha=false
```

Point the scripts at the deployed services with `SENDER_MCP_URL=https://<sender-app>.fly.dev/mcp` and `AGENT_URL=https://<agent-app>.fly.dev`. For example, `SENDER_MCP_URL=... AGENT_URL=... npm run scenarios`.

## Known limits

- **`hookdeck listen` restarts for each new source,** because a running `listen` doesn't pick up sources created after it started ([hookdeck-cli#467](https://github.com/hookdeck/hookdeck-cli/issues/467)). The agent restarts it.
- **The CLI path isn't durable while `listen` is disconnected.** After a short grace window, no event is created; the request is stored, and retrying it creates the event. Recovery on agent start isn't built yet.
- **No secret overlap on a source during rotation.** The sender dual-signs for a grace window, but a source holds one secret.
- **The stand-in sender** keeps subscriptions in memory, checks callback URLs only for `https`, and uses a static bearer token instead of OAuth.
