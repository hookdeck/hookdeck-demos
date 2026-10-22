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
