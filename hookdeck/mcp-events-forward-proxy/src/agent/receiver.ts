import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { verifyStandardWebhook } from '../shared/standard-webhooks.js';
import { SUBSCRIPTION_HEADER, type ControlEnvelope, type McpEvent } from '../shared/mcp-events.js';

/*
 * The agent's event endpoint: where Event Gateway delivers. Event Gateway has
 * already verified the MCP server's signature, answered the challenge and
 * stored the request. This endpoint:
 *
 * 1. checks the delivery came through Event Gateway, with the destination's
 *    auth method:
 *    - Standard Webhooks: Event Gateway re-signs each attempt with the
 *      subscription's secret, so the endpoint verifies that signature,
 *      including the 5-minute window on `webhook-timestamp`, the same check it
 *      would make on a delivery sent straight from the MCP server;
 *    - a bearer token: the check an API gateway in front of the agent would
 *      make. There's no signature to verify; Event Gateway verified the MCP
 *      server's at the source;
 * 2. handles each `eventId` once, so a redelivery is harmless.
 */

export interface HandledEvent {
  eventId: string;
  name: string;
  subscriptionId: string;
  data: Record<string, unknown>;
  receivedAt: string;
  attempt: string | null;
}

/** What the endpoint expects of each delivery, matching the destination's auth method. */
export type ReceiverAuth = { type: 'STANDARD_WEBHOOKS' } | { type: 'BEARER_TOKEN'; token: string };

export interface ReceiverOptions {
  auth: ReceiverAuth;
  secretFor: (subscriptionId: string) => string | undefined;
  onEvent?: (event: HandledEvent) => void;
  onTerminated?: (subscriptionId: string, envelope: ControlEnvelope) => void;
  log: (message: string) => void;
}

const MAX_BODY_BYTES = 256 * 1024;

export class Receiver {
  readonly handled: HandledEvent[] = [];
  readonly counts = { duplicates: 0, verificationIgnored: 0, rejected: 0, failedOnPurpose: 0 };
  /** When true, the endpoint answers 503 to every delivery, to show Event Gateway holding and retrying. */
  failing = false;
  private readonly seen = new Set<string>();

  constructor(private readonly options: ReceiverOptions) {}

  private bearerMatches(req: http.IncomingMessage, token: string): boolean {
    const presented = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '');
    const expected = Buffer.from(token);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body?: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return send(413);
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks);
    const webhookId = String(req.headers['webhook-id'] ?? '');
    const attempt = typeof req.headers['x-hookdeck-attempt-count'] === 'string' ? req.headers['x-hookdeck-attempt-count'] : null;

    const { auth } = this.options;
    // As an API gateway would, refuse a request without the token before routing it.
    if (auth.type === 'BEARER_TOKEN' && !this.bearerMatches(req, auth.token)) {
      this.counts.rejected++;
      this.options.log(`rejected ${webhookId || '(no webhook-id)'}: missing or wrong bearer token`);
      return send(401);
    }

    const subscriptionId = String(req.headers[SUBSCRIPTION_HEADER] ?? '');
    const secret = this.options.secretFor(subscriptionId);
    if (!secret) {
      // SEP-3415: a delivery for an id the receiver can't route yet gets a retryable status.
      this.options.log(`unknown subscription ${subscriptionId || '(none)'} for ${webhookId}: 503, Event Gateway will retry`);
      return send(503);
    }
    if (auth.type === 'STANDARD_WEBHOOKS') {
      const signed = {
        'webhook-id': webhookId,
        'webhook-timestamp': String(req.headers['webhook-timestamp'] ?? ''),
        'webhook-signature': String(req.headers['webhook-signature'] ?? ''),
      };
      if (!verifyStandardWebhook(secret, raw.toString('utf8'), signed)) {
        this.counts.rejected++;
        this.options.log(`rejected ${webhookId}: the signature doesn't match the subscription's secret, or the timestamp is more than 5 minutes off`);
        return send(401);
      }
    }

    if (this.failing) {
      this.counts.failedOnPurpose++;
      this.options.log(`failing on purpose: 503 for ${webhookId} (attempt ${attempt ?? '?'})`);
      return send(503);
    }

    const body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    if (typeof body.type === 'string') {
      const envelope = body as unknown as ControlEnvelope;
      if (envelope.type === 'verification') {
        // Event Gateway answers the challenge for us. Whether a proxy should also forward it is an open question.
        this.counts.verificationIgnored++;
        this.options.log(`ignored a verification envelope (${webhookId}); Event Gateway answers challenges`);
        return send(200);
      }
      this.options.log(`control envelope for ${subscriptionId}: ${raw.toString('utf8')}`);
      if (envelope.type === 'terminated') this.options.onTerminated?.(subscriptionId, envelope);
      return send(200);
    }

    const event = body as unknown as McpEvent;
    if (this.seen.has(event.eventId)) {
      this.counts.duplicates++;
      this.options.log(`already handled ${event.eventId}; ignoring the redelivery`);
      return send(200);
    }
    this.seen.add(event.eventId);
    const handled: HandledEvent = {
      eventId: event.eventId,
      name: event.name,
      subscriptionId,
      data: event.data,
      receivedAt: new Date().toISOString(),
      attempt,
    };
    this.handled.push(handled);
    this.options.log(`handled ${event.name} ${event.eventId} (attempt ${attempt ?? '?'}): ${JSON.stringify(event.data)}`);
    this.options.onEvent?.(handled);
    send(200);
  }
}
