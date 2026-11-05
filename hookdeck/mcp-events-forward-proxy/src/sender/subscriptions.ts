import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../shared/canonical-json.js';
import { isValidWebhookSecret } from '../shared/secret.js';
import type { SubscribeResult } from '../shared/mcp-events.js';
import { deliver, verifyEndpoint, type AttemptRecord } from './deliver.js';
import { callbackEndpointError, forbidden, invalidParams, notFound, unsupported } from './errors.js';
import { ERROR_DETECTED, errorArguments, matchesArguments, SAMPLE_ERRORS, type DetectedError, type ErrorArguments, type Level } from './events.js';

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
  arguments: ErrorArguments;
  url: string;
  secret: string;
  previousSecret?: { secret: string; until: number };
  expiresAt: number;
  lastDelivery?: { webhookId: string; attempts: AttemptRecord[] };
  /** For the demo's visualization: the first subscribe, the last challenge echoed, and the last subscribe. */
  subscribedAt: string;
  verifiedAt?: string;
  refreshedAt: string;
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
/** An error the sender reported, and every delivery attempt for it so far. For the demo's visualization. */
export interface ErrorRecord {
  eventId: string;
  error: DetectedError;
  duplicate: boolean;
  badSignature: boolean;
  sentAt: string;
  deliveries: Array<{ subscriptionId: string; attempts: AttemptRecord[] }>;
}

const KEEP_ERRORS = 25;

export class Subscriptions {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly errors: ErrorRecord[] = [];
  private nextSample = 0;
  /** Verification is cached per (principal, url). */
  private readonly verifiedUntil = new Map<string, number>();

  constructor(
    private readonly config: SenderConfig,
    private readonly log: (message: string) => void,
  ) {}

  private parseKey(params: Params) {
    if (params.name !== ERROR_DETECTED) {
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
    const parsed = errorArguments.safeParse(rawArgs);
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
    const id = deriveSubscriptionId(principal, url, ERROR_DETECTED, args);
    const now = Date.now();

    const verificationKey = canonicalJson([principal, url]);
    let verifiedAt: string | undefined;
    if ((this.verifiedUntil.get(verificationKey) ?? 0) <= now) {
      const result = await verifyEndpoint(url, secret, id, { timeoutMs: this.config.timeoutMs });
      if (!result.ok) {
        this.log(`verification of ${url} failed: ${result.reason}${result.status ? ` (${result.status})` : ''}`);
        throw callbackEndpointError(result.reason);
      }
      this.verifiedUntil.set(verificationKey, now + this.config.maxTtlMs);
      verifiedAt = new Date().toISOString();
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
      name: ERROR_DETECTED,
      arguments: parsedArgs,
      url,
      secret,
      previousSecret,
      expiresAt: now + ttl,
      lastDelivery: existing?.lastDelivery,
      subscribedAt: existing?.subscribedAt ?? new Date(now).toISOString(),
      verifiedAt: verifiedAt ?? existing?.verifiedAt,
      refreshedAt: new Date().toISOString(),
    };
    this.subscriptions.set(id, subscription);
    this.log(`${existing ? 'refreshed' : 'subscribed'} ${id} until ${new Date(subscription.expiresAt).toISOString()}`);

    const last = existing?.lastDelivery?.attempts.at(-1);
    return {
      id,
      refreshBefore: new Date(subscription.expiresAt).toISOString(),
      cursor: null, // error.detected has no replay
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
    const id = deriveSubscriptionId(principal, url, ERROR_DETECTED, args);
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
   * Reports a new error and delivers `error.detected` to every live, matching
   * subscription. Without a title it uses the next sample error. `duplicate`
   * delivers the same event twice (same `webhook-id`, re-signed), as a sender
   * would after a timeout. `badSignature` signs with a secret the receiver
   * doesn't know.
   */
  async emit(input: { title?: string; culprit?: string; level?: Level; duplicate?: boolean; badSignature?: boolean }) {
    const sample = SAMPLE_ERRORS[this.nextSample++ % SAMPLE_ERRORS.length];
    const error: DetectedError = {
      errorId: `err_${randomUUID().slice(0, 8)}`,
      title: input.title ?? sample.title,
      culprit: input.culprit ?? sample.culprit,
      level: input.level ?? sample.level,
      environment: 'production',
      release: 'web@2.14.0',
      firstSeen: new Date().toISOString(),
      occurrences: 1,
    };
    const eventId = `evt_${randomUUID().replaceAll('-', '')}`;
    const body = JSON.stringify({ eventId, name: ERROR_DETECTED, timestamp: error.firstSeen, data: error, cursor: null });
    const now = Date.now();
    const targets = [...this.subscriptions.values()].filter((s) => s.expiresAt > now && matchesArguments(s.arguments, error));
    this.log(`error ${error.errorId} (${error.level}) "${error.title}" as ${eventId}: ${targets.length} matching subscription(s)`);
    const record: ErrorRecord = {
      eventId,
      error,
      duplicate: input.duplicate === true,
      badSignature: input.badSignature === true,
      sentAt: new Date(now).toISOString(),
      deliveries: targets.map((s) => ({ subscriptionId: s.id, attempts: [] })),
    };
    this.errors.push(record);
    if (this.errors.length > KEEP_ERRORS) this.errors.shift();

    const deliveries = await Promise.all(
      targets.map(async (subscription, i) => {
        const secrets = [subscription.secret];
        if (subscription.previousSecret && subscription.previousSecret.until > now) secrets.push(subscription.previousSecret.secret);
        const target = { subscriptionId: subscription.id, url: subscription.url, secrets };
        const onAttempt = (attempt: AttemptRecord) => record.deliveries[i].attempts.push(attempt);
        const options = { timeoutMs: this.config.timeoutMs, retryDelaysMs: this.config.retryDelaysMs, badSignature: input.badSignature, log: this.log, onAttempt };
        const attempts = await deliver(target, eventId, body, options);
        if (input.duplicate) attempts.push(...(await deliver(target, eventId, body, options)));
        subscription.lastDelivery = { webhookId: eventId, attempts };
        return { subscriptionId: subscription.id, attempts };
      }),
    );
    return { error, eventId, deliveries };
  }

  /** Recent errors and their delivery attempts, oldest first. */
  recentErrors(): ErrorRecord[] {
    return this.errors;
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
