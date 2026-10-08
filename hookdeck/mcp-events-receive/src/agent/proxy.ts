import { randomBytes } from 'node:crypto';
import { generateWebhookSecret } from '../shared/secret.js';
import type { HookdeckApi } from './hookdeck.js';

/*
 * The client side of the forward proxy: everything the agent asks of Event
 * Gateway. SEP-3415 says the client SDK "registers [the secret] with the
 * gateway" but doesn't say how, so this module is the one place that knows.
 * Swap it out to use a different proxy.
 *
 * One MCP Events source per subscription, holding that subscription's secret,
 * plus one connection that delivers to the agent with a deduplicate rule on
 * `webhook-id` and a retry rule.
 */

export interface ProxyEndpoint {
  /** The callback URL to give the MCP server: the source URL. */
  url: string;
  secret: string;
  sourceId: string;
  sourceName: string;
  connectionId: string;
  destinationId: string;
}

/** What the subscription is for, stored on the source so a restarted agent can unsubscribe it. */
export interface SubscriptionKey {
  serverUrl: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type DeliverTo = { type: 'http'; url: string } | { type: 'cli'; path: string };

export interface ProxyOptions {
  /** Prefix for resource names, so the agent can find its own resources after a restart. */
  namePrefix: string;
  deliverTo: DeliverTo;
  retry: { strategy: 'linear' | 'exponential'; intervalMs: number; count: number };
  dedupWindowMs: number;
}

export async function provisionEndpoint(api: HookdeckApi, key: SubscriptionKey, options: ProxyOptions): Promise<ProxyEndpoint> {
  const secret = generateWebhookSecret();
  const name = `${options.namePrefix}-${randomBytes(4).toString('hex')}`;
  const source = await api.createMcpEventsSource(name, secret, JSON.stringify(key));
  try {
    const destination =
      options.deliverTo.type === 'http'
        ? { name, type: 'HTTP', config: { url: options.deliverTo.url } }
        : { name, type: 'CLI', config: { path: options.deliverTo.path } };
    const connection = await api.createConnection({
      name,
      sourceId: source.id,
      destination,
      rules: [
        { type: 'deduplicate', window: options.dedupWindowMs, include_fields: ['headers.webhook-id'] },
        { type: 'retry', strategy: options.retry.strategy, interval: options.retry.intervalMs, count: options.retry.count },
      ],
    });
    return { url: source.url, secret, sourceId: source.id, sourceName: source.name, connectionId: connection.id, destinationId: connection.destination.id };
  } catch (error) {
    await api.delete('sources', source.id);
    throw error;
  }
}

export async function releaseEndpoint(api: HookdeckApi, endpoint: Pick<ProxyEndpoint, 'sourceId' | 'connectionId' | 'destinationId'>) {
  await api.delete('connections', endpoint.connectionId);
  await api.delete('destinations', endpoint.destinationId);
  await api.delete('sources', endpoint.sourceId);
}

/** Endpoints left by an earlier run of this agent, with the subscription each was created for. */
export async function findEndpoints(api: HookdeckApi, namePrefix: string) {
  const connections = await api.listConnections(`${namePrefix}-`);
  return connections.map((connection) => {
    let key: SubscriptionKey | null = null;
    try {
      key = JSON.parse(connection.source.description ?? '') as SubscriptionKey;
    } catch {
      // not one of ours, or created by hand
    }
    return {
      url: connection.source.url,
      sourceId: connection.source.id,
      sourceName: connection.source.name,
      connectionId: connection.id,
      destinationId: connection.destination.id,
      key,
    };
  });
}
