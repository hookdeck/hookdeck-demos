import { Webhook } from 'standardwebhooks';

export interface SignedHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

/**
 * Builds Standard Webhooks headers for a body. With more than one secret the
 * signature header carries one `v1,<sig>` entry per secret, space-separated,
 * which is how secret rotation works (receivers accept any matching entry).
 * Adapted from hookdeck/mcp-events-outpost-demo (MIT).
 */
export function signStandardWebhook(secrets: string[], msgId: string, body: string, timestamp = new Date()): SignedHeaders {
  if (secrets.length === 0) throw new Error('At least one secret is required');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': secrets.map((secret) => new Webhook(secret).sign(msgId, timestamp, body)).join(' '),
  };
}

/**
 * Verifies a Standard Webhooks signature without the library's 5-minute
 * freshness window. With Event Gateway's default destination auth, a delivery
 * attempt forwards the stored request's headers, so a retry carries the MCP
 * server's original `webhook-timestamp` and would fail the window. Event
 * Gateway checked the signature on receipt; this re-check only confirms the
 * body is the one the MCP server signed.
 */
export function verifyIgnoringTimestamp(secret: string, body: string, headers: SignedHeaders): boolean {
  const webhook = new Webhook(secret);
  (webhook as unknown as { verifyTimestamp: (header: string) => Date }).verifyTimestamp = (header) => new Date(Number(header) * 1000);
  try {
    webhook.verify(body, { ...headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies a Standard Webhooks signature, including the library's 5-minute
 * window on `webhook-timestamp`. Event Gateway re-signs every delivery attempt,
 * so a retry carries a fresh timestamp and still passes.
 */
export function verifyStandardWebhook(secret: string, body: string, headers: SignedHeaders): boolean {
  try {
    new Webhook(secret).verify(body, { ...headers });
    return true;
  } catch {
    return false;
  }
}
