import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as z from 'zod';
import type { SubscribeResult } from '../shared/mcp-events.js';
import type { SubscriptionKey } from './proxy.js';

const anyResult = z.record(z.string(), z.unknown());

/** The `events/*` methods whose `params.name` SEP-3415 mirrors in the `Mcp-Name` header. */
const NAMED_EVENTS_METHODS = new Set(['events/poll', 'events/stream', 'events/subscribe', 'events/unsubscribe']);

/**
 * SEP-3415: over Streamable HTTP, `events/poll`, `events/stream`, `events/subscribe` and
 * `events/unsubscribe` carry `Mcp-Name` set to the event name. The SDK sets `Mcp-Name` only for
 * tools, prompts, resources and tasks, so this adds it. Event names here are plain ASCII; one that
 * isn't would need SEP-2243's Base64 form, which the demo doesn't implement.
 */
const fetchWithMcpName: typeof fetch = (input, init) => {
  if (typeof init?.body === 'string') {
    let message: { method?: unknown; params?: { name?: unknown } } | undefined;
    try {
      message = JSON.parse(init.body);
    } catch {
      // not a single JSON-RPC message
    }
    if (typeof message?.method === 'string' && NAMED_EVENTS_METHODS.has(message.method) && typeof message.params?.name === 'string') {
      const headers = new Headers(init.headers);
      headers.set('Mcp-Name', message.params.name);
      return fetch(input, { ...init, headers });
    }
  }
  return fetch(input, init);
};

/**
 * The agent's MCP client for MCP Events. The SDK has no Events support yet, so
 * `server/discover` and the `events/*` methods are sent as raw requests.
 */
export class EventsClient {
  private readonly client = new Client({ name: 'mcp-events-forward-proxy-agent', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });

  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      fetch: fetchWithMcpName,
    });
    await this.client.connect(transport);
  }

  /** Checks the server declares MCP Events and offers the event with webhook delivery. */
  async checkEvent(name: string): Promise<void> {
    // The SDK's typed capabilities drop unknown keys like `events`, so read server/discover directly.
    const discover = await this.client.request({ method: 'server/discover', params: {} }, anyResult);
    const capabilities = discover.capabilities as Record<string, unknown> | undefined;
    if (!capabilities?.events) throw new Error('Server does not declare the events capability');
    const list = await this.client.request({ method: 'events/list', params: {} } as never, anyResult);
    const event = (list.events as Array<{ name: string; delivery: string[] }>).find((e) => e.name === name);
    if (!event) throw new Error(`Server does not offer ${name}`);
    if (!event.delivery.includes('webhook')) throw new Error(`${name} does not support webhook delivery`);
  }

  /** First subscribe and every refresh use the same key: (name, arguments, delivery.url). */
  async subscribe(key: SubscriptionKey, url: string, secret: string, ttlMs?: number): Promise<SubscribeResult> {
    const params = {
      name: key.name,
      arguments: key.arguments,
      delivery: { mode: 'webhook', url, secret },
      cursor: null,
      ...(ttlMs !== undefined && { ttlMs }),
    };
    return (await this.client.request({ method: 'events/subscribe', params } as never, anyResult)) as unknown as SubscribeResult;
  }

  async unsubscribe(key: SubscriptionKey, url: string): Promise<void> {
    const params = { name: key.name, arguments: key.arguments, delivery: { mode: 'webhook', url } };
    await this.client.request({ method: 'events/unsubscribe', params } as never, anyResult);
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
