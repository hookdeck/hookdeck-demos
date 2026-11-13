# Send MCP Events with Hookdeck Outpost

The sending side of [MCP Events](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415) (SEP-3415, a draft MCP extension) lives in its own repository, because it stands on its own as a reference implementation of an MCP server that sends MCP Events:

**[hookdeck/mcp-events-outpost-demo](https://github.com/hookdeck/mcp-events-outpost-demo)**

It's an MCP server that offers `events/list`, `events/subscribe` and `events/unsubscribe` by forwarding them to Hookdeck Outpost's [MCP Events support](https://hookdeck.com/docs/outpost/features/mcp-events) (Outpost v1.9.0 and later, experimental). Outpost verifies each callback URL, stores and expires the subscriptions, filters on their arguments, and signs, retries and delivers each event to every subscribed agent. The server authenticates the agent, picks its Outpost tenant and publishes events.

- **Guide:** [Send MCP Events Webhooks with Outpost](https://hookdeck.com/docs/outpost/guides/send-mcp-events-webhooks-with-outpost)
- **The receiving side:** [`hookdeck/mcp-events-forward-proxy`](../mcp-events-forward-proxy/), where an agent receives MCP Events through Hookdeck Event Gateway acting as its forward proxy.
