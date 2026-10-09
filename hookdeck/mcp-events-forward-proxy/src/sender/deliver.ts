import { randomBytes, timingSafeEqual } from 'node:crypto';
import { signStandardWebhook } from '../shared/standard-webhooks.js';
import { generateWebhookSecret } from '../shared/secret.js';
import type { CallbackFailureReason } from './errors.js';

/*
 * Outbound webhook requests: the verification challenge and event deliveries.
 *
 * Kept deliberately small. A production MCP server also needs SSRF protection
 * (block non-public addresses at connect time); see hookdeck/mcp-events-outpost-demo
 * for that. This stand-in only requires https and never follows redirects.
 */

export interface PostResult {
  status: number;
  body: string;
}

export interface PostOptions {
  timeoutMs: number;
}

async function post(url: string, body: string, headers: Record<string, string>, { timeoutMs }: PostOptions): Promise<PostResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: (await response.text()).slice(0, 64 * 1024) };
}

function classifyNetworkError(error: unknown): CallbackFailureReason {
  const name = (error as { name?: string })?.name;
  const code = String((error as { cause?: { code?: string } })?.cause?.code ?? '');
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (/CERT|TLS|SSL|SELF_SIGNED/.test(code)) return 'tls_error';
  return 'connection_refused';
}

function statusCategory(status: number): CallbackFailureReason | null {
  if (status >= 200 && status < 300) return null;
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

export type VerificationResult = { ok: true } | { ok: false; reason: CallbackFailureReason; status?: number };

/**
 * Endpoint verification: POST a signed `verification` control envelope with a
 * single-use challenge. The endpoint proves it wants deliveries by answering
 * 2xx with `{"challenge": "<same value>"}`.
 */
export async function verifyEndpoint(url: string, secret: string, subscriptionId: string, options: PostOptions): Promise<VerificationResult> {
  const challenge = randomBytes(24).toString('base64url');
  const msgId = `msg_verification_${randomBytes(12).toString('hex')}`;
  const body = JSON.stringify({ type: 'verification', challenge });
  const headers = { ...signStandardWebhook([secret], msgId, body), 'X-MCP-Subscription-Id': subscriptionId };

  let result: PostResult;
  try {
    result = await post(url, body, headers, options);
  } catch (error) {
    return { ok: false, reason: classifyNetworkError(error) };
  }
  const category = statusCategory(result.status);
  if (category) return { ok: false, reason: result.status >= 300 && result.status < 400 ? 'challenge_failed' : category, status: result.status };

  let echoed: unknown;
  try {
    echoed = (JSON.parse(result.body) as { challenge?: unknown })?.challenge;
  } catch {
    return { ok: false, reason: 'challenge_failed', status: result.status };
  }
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(typeof echoed === 'string' ? echoed : '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'challenge_failed', status: result.status };
  }
  return { ok: true };
}

export interface DeliveryTarget {
  subscriptionId: string;
  url: string;
  /** Current secret first; a recently rotated-out secret second, for dual-signing. */
  secrets: string[];
}

export interface AttemptRecord {
  attempt: number;
  at: string;
  status: number | null;
  error: CallbackFailureReason | null;
}

export interface DeliveryOptions extends PostOptions {
  /** Delays before each retry, in milliseconds. Its length plus one is the attempt count. */
  retryDelaysMs: number[];
  /** Sign with a random secret instead of the subscription's, to show the receiver rejecting it. */
  badSignature?: boolean;
  log: (message: string) => void;
}

/**
 * Delivers one body with bounded retries. Every attempt is re-signed with a
 * fresh timestamp (MCP Events requires it); `webhook-id` stays the same so the
 * receiver can dedupe. 410 and 413 are never retried.
 */
export async function deliver(target: DeliveryTarget, webhookId: string, body: string, options: DeliveryOptions): Promise<AttemptRecord[]> {
  const attempts: AttemptRecord[] = [];
  const secrets = options.badSignature ? [generateWebhookSecret()] : target.secrets;
  for (let attempt = 1; attempt <= options.retryDelaysMs.length + 1; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, options.retryDelaysMs[attempt - 2]));
    const headers = { ...signStandardWebhook(secrets, webhookId, body), 'X-MCP-Subscription-Id': target.subscriptionId };
    let record: AttemptRecord;
    try {
      const result = await post(target.url, body, headers, options);
      record = { attempt, at: new Date().toISOString(), status: result.status, error: statusCategory(result.status) };
    } catch (error) {
      record = { attempt, at: new Date().toISOString(), status: null, error: classifyNetworkError(error) };
    }
    attempts.push(record);
    options.log(`deliver ${webhookId} -> ${target.subscriptionId} attempt ${attempt}: ${record.status ?? record.error}`);
    if (record.error === null) break;
    if (record.status === 410 || record.status === 413) break;
  }
  return attempts;
}
