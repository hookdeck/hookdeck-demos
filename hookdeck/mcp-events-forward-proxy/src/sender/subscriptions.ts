import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../shared/canonical-json.js';
import { isValidWebhookSecret } from '../shared/secret.js';
import type { SubscribeResult } from '../shared/mcp-events.js';
import { deliver, verifyEndpoint, type AttemptRecord } from './deliver.js';
import { callbackEndpointError, forbidden, invalidParams, notFound, unsupported } from './errors.js';
import { INCIDENT_CREATED, incidentArguments, matchesArguments, type Incident, type IncidentArguments, type Severity } from './events.js';

export interface SenderConfig {
  defaultTtlMs: number;
  minTtlMs: number;
  maxTtlMs: number;
  allowHttpCallbacks: boolean;
  timeoutMs: number;
  retryDelaysMs: number[];
  rotationGraceMs: number;
}

interface Subscription {
  id: string;
  principal: string;
  name: string;
  arguments: IncidentArguments;
  url: string;
  secret: string;
  previousSecret?: { secret: string; until: number };
  expiresAt: number;
  lastDelivery?: { webhookId: string; attempts: AttemptRecord[] };
}

type Params = Record<string, unknown>;

/**
 * The subscription key is (principal, delivery.url, name, arguments). The id is
 * a hash of it, so subscribe is an idempotent upsert and a refresh finds the
 * same subscription.
 */
export function deriveSubscriptionId(principal: string, url: string, name: string, args: Params): string {
  const hash = createHash('sha256').update(canonicalJson({ principal, url, name, arguments: args })).digest('hex');
  return `sub_${hash.slice(0, 32)}`;
}

/** Request params for the log, with the signing secret replaced by its shape. */
function describe(params: Params): string {
  const delivery = params.delivery as Params | undefined;
  if (!delivery || !('secret' in delivery)) return JSON.stringify(params);
  return JSON.stringify({ ...params, delivery: { ...delivery, secret: isValidWebhookSecret(delivery.secret) ? '<whsec_>' : '<invalid>' } });
}

/**
 * In-memory MCP Events webhook subscriptions: verification before activation,
 * TTL grants with a sweeper, dual-signing during secret rotation, and delivery
 * with bounded retries.
 */
export class Subscriptions {
  private readonly subscriptions = new Map<string, Subscription>();
  /** Verification is cached per (principal, url). */
  private readonly verifiedUntil = new Map<string, number>();

  constructor(
    private readonly config: SenderConfig,
    private readonly log: (message: string) => void,
  ) {}

  private parseKey(params: Params) {
    if (params.name !== INCIDENT_CREATED) {
      if (typeof params.name !== 'string') throw invalidParams('name is required');
      throw notFound(`Unknown event: ${params.name}`);
    }
    const delivery = params.delivery as Params | undefined;
    if (!delivery || typeof delivery !== 'object') throw invalidParams('delivery is required');
    if (delivery.mode !== undefined && delivery.mode !== 'webhook') throw unsupported('deliveryMode', delivery.mode);
    if (typeof delivery.url !== 'string') throw invalidParams('delivery.url is required');
    let url: URL;
    try {
      url = new URL(delivery.url);
    } catch {
      throw invalidParams('delivery.url is not a valid URL', { field: 'delivery.url' });
    }
    if (url.protocol !== 'https:' && !(this.config.allowHttpCallbacks && url.protocol === 'http:')) {
      throw invalidParams('delivery.url must use https', { field: 'delivery.url' });
    }
    const rawArgs = params.arguments ?? {};
    const parsed = incidentArguments.safeParse(rawArgs);
    if (!parsed.success) throw invalidParams('arguments do not match the inputSchema');
    return { url: url.href, args: rawArgs as Params, parsedArgs: parsed.data, delivery };
  }

  async subscribe(principal: string | undefined, params: Params): Promise<SubscribeResult> {
    this.log(`events/subscribe from ${principal ?? '(none)'}: ${describe(params)}`);
    if (!principal) throw forbidden();
    const { url, args, parsedArgs, delivery } = this.parseKey(params);
    if (!isValidWebhookSecret(delivery.secret)) {
      throw invalidParams('delivery.secret must be whsec_ followed by base64 of 24 to 64 bytes', { field: 'delivery.secret' });
    }
    const secret = delivery.secret;
    const id = deriveSubscriptionId(principal, url, INCIDENT_CREATED, args);
    const now = Date.now();

    const verificationKey = canonicalJson([principal, url]);
    if ((this.verifiedUntil.get(verificationKey) ?? 0) <= now) {
      const result = await verifyEndpoint(url, secret, id, { timeoutMs: this.config.timeoutMs });
      if (!result.ok) {
        this.log(`verification of ${url} failed: ${result.reason}${result.status ? ` (${result.status})` : ''}`);
        throw callbackEndpointError(result.reason);
      }
      this.verifiedUntil.set(verificationKey, now + this.config.maxTtlMs);
      this.log(`verified ${url}: challenge echoed`);
    }

    const requested = params.ttlMs;
    const ttl =
      typeof requested === 'number' ? Math.min(Math.max(requested, this.config.minTtlMs), this.config.maxTtlMs) : this.config.defaultTtlMs;
    const existing = this.subscriptions.get(id);
    const previousSecret =
      existing && existing.secret !== secret ? { secret: existing.secret, until: now + this.config.rotationGraceMs } : existing?.previousSecret;
    if (existing && existing.secret !== secret) this.log(`rotated secret for ${id}; dual-signing for ${this.config.rotationGraceMs} ms`);

    const subscription: Subscription = {
      id,
      principal,
      name: INCIDENT_CREATED,
      arguments: parsedArgs,
      url,
      secret,
      previousSecret,
      expiresAt: now + ttl,
      lastDelivery: existing?.lastDelivery,
    };
    this.subscriptions.set(id, subscription);
    this.log(`${existing ? 'refreshed' : 'subscribed'} ${id} until ${new Date(subscription.expiresAt).toISOString()}`);

    const last = existing?.lastDelivery?.attempts.at(-1);
    return {
      id,
      refreshBefore: new Date(subscription.expiresAt).toISOString(),
      cursor: null, // incident.created has no replay
      truncated: params.cursor !== undefined && params.cursor !== null,
      ...(existing && {
        deliveryStatus: {
          active: true,
          lastDeliveryAt: last && last.error === null ? last.at : null,
          lastError: last?.error ?? null,
        },
      }),
    };
  }

  /** Idempotent: an unknown subscription returns an empty result, as OpenAI's guide does (SEP-3415 returns NotFound). */
  unsubscribe(principal: string | undefined, params: Params): Record<string, never> {
    this.log(`events/unsubscribe from ${principal ?? '(none)'}: ${describe(params)}`);
    if (!principal) throw forbidden();
    const { url, args } = this.parseKey(params);
    const id = deriveSubscriptionId(principal, url, INCIDENT_CREATED, args);
    if (this.subscriptions.delete(id)) this.log(`unsubscribed ${id}`);
    return {};
  }

  /** Removes subscriptions whose grant lapsed without a refresh. */
  sweep(): void {
    const now = Date.now();
    for (const subscription of this.subscriptions.values()) {
      if (subscription.expiresAt <= now) {
        this.subscriptions.delete(subscription.id);
        this.log(`expired ${subscription.id}`);
      }
    }
  }

  /**
   * Opens an incident and delivers `incident.created` to every live, matching
   * subscription. `duplicate` delivers the same event twice (same `webhook-id`,
   * re-signed), as a sender would after a timeout. `badSignature` signs with a
   * secret the receiver doesn't know.
   */
  async emit(input: { severity?: Severity; title?: string; duplicate?: boolean; badSignature?: boolean }) {
    const incident: Incident = {
      incidentId: `INC-${randomUUID().slice(0, 8)}`,
      severity: input.severity ?? 'P2',
      title: input.title ?? 'Checkout latency above 2 s',
      openedAt: new Date().toISOString(),
    };
    const eventId = `evt_${randomUUID().replaceAll('-', '')}`;
    const body = JSON.stringify({ eventId, name: INCIDENT_CREATED, timestamp: incident.openedAt, data: incident, cursor: null });
    const now = Date.now();
    const targets = [...this.subscriptions.values()].filter((s) => s.expiresAt > now && matchesArguments(s.arguments, incident));
    this.log(`incident ${incident.incidentId} (${incident.severity}) as ${eventId}: ${targets.length} matching subscription(s)`);

    const deliveries = await Promise.all(
      targets.map(async (subscription) => {
        const secrets = [subscription.secret];
        if (subscription.previousSecret && subscription.previousSecret.until > now) secrets.push(subscription.previousSecret.secret);
        const target = { subscriptionId: subscription.id, url: subscription.url, secrets };
        const options = { timeoutMs: this.config.timeoutMs, retryDelaysMs: this.config.retryDelaysMs, badSignature: input.badSignature, log: this.log };
        const attempts = await deliver(target, eventId, body, options);
        if (input.duplicate) attempts.push(...(await deliver(target, eventId, body, options)));
        subscription.lastDelivery = { webhookId: eventId, attempts };
        return { subscriptionId: subscription.id, attempts };
      }),
    );
    return { incident, eventId, deliveries };
  }

  /** For the demo's status endpoint: subscriptions without their secrets. */
  list() {
    return [...this.subscriptions.values()].map(({ secret: _secret, previousSecret, ...rest }) => ({
      ...rest,
      expiresAt: new Date(rest.expiresAt).toISOString(),
      rotating: Boolean(previousSecret && previousSecret.until > Date.now()),
    }));
  }
}
