import { randomBytes } from 'node:crypto';

// Adapted from hookdeck/mcp-events-outpost-demo (MIT).

export const SECRET_PREFIX = 'whsec_';

// Strict standard base64 (with padding), as Standard Webhooks secrets use.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * A Standard Webhooks symmetric secret: `whsec_` + base64 of 24 to 64 bytes.
 * MCP Events requires servers to reject anything else with InvalidParams.
 */
export function isValidWebhookSecret(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(SECRET_PREFIX)) return false;
  const encoded = value.slice(SECRET_PREFIX.length);
  if (encoded.length === 0 || !BASE64.test(encoded)) return false;
  const length = Buffer.from(encoded, 'base64').length;
  return length >= 24 && length <= 64;
}

/** Generates a fresh secret from a CSPRNG. Subscribers own the secret; servers never create one. */
export function generateWebhookSecret(bytes = 32): string {
  return SECRET_PREFIX + randomBytes(bytes).toString('base64');
}
