import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyIgnoringTimestamp } from '../shared/standard-webhooks.js';
import { SUBSCRIPTION_HEADER, type ControlEnvelope, type McpEvent } from '../shared/mcp-events.js';

/*
 * The agent's event endpoint: where Event Gateway delivers. Event Gateway has
 * already verified the MCP server's signature, answered the challenge and
 * stored the request. This endpoint:
 *
 * 1. checks the request came from Event Gateway (`x-hookdeck-signature`, an
 *    HMAC of the body with the project's signing secret, no timestamp);
 * 2. re-checks the MCP server's Standard Webhooks signature with the
 *    subscription's secret, without the 5-minute window, because a retried or
 *    replayed delivery keeps its original `webhook-timestamp`;
 * 3. handles each `eventId` once, so a redelivery is harmless.
 */

export interface HandledEvent {
  eventId: string;
  name: string;
  subscriptionId: string;
  data: Record<string, unknown>;
  receivedAt: string;
  attempt: string | null;
}

export interface ReceiverOptions {
  /** Event Gateway's project signing secret. Required when Event Gateway reaches the agent over the internet. */
  hookdeckSigningSecret?: string;
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

  private fromEventGateway(raw: Buffer, headers: http.IncomingHttpHeaders): boolean {
    const secret = this.options.hookdeckSigningSecret;
    if (!secret) return true;
    const expected = createHmac('sha256', secret).update(raw).digest('base64');
    return ['x-hookdeck-signature', 'x-hookdeck-signature-2'].some((name) => {
      const value = headers[name];
      if (typeof value !== 'string' || value.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
    });
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

    if (!this.fromEventGateway(raw, req.headers)) {
      this.counts.rejected++;
      this.options.log(`rejected ${webhookId}: not signed by Event Gateway`);
      return send(401);
    }

    const subscriptionId = String(req.headers[SUBSCRIPTION_HEADER] ?? '');
    const secret = this.options.secretFor(subscriptionId);
    if (!secret) {
      // SEP-3415: a delivery for an id the receiver can't route yet gets a retryable status.
      this.options.log(`unknown subscription ${subscriptionId || '(none)'} for ${webhookId}: 503, Event Gateway will retry`);
      return send(503);
    }
    const signed = {
      'webhook-id': webhookId,
      'webhook-timestamp': String(req.headers['webhook-timestamp'] ?? ''),
      'webhook-signature': String(req.headers['webhook-signature'] ?? ''),
    };
    if (!verifyIgnoringTimestamp(secret, raw.toString('utf8'), signed)) {
      this.counts.rejected++;
      this.options.log(`rejected ${webhookId}: MCP server signature doesn't match the subscription's secret`);
      return send(401);
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
