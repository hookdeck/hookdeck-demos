import crypto from 'crypto';

/**
 * Retell signs `raw_body + timestamp` with HMAC-SHA256 (hex) and sends
 * `x-retell-signature: v=<unix ms>,d=<digest>`. The secret is the Retell API key
 * that carries the webhook badge. https://docs.retellai.com/features/secure-webhook
 *
 * Hookdeck verifies this at the source, so the app never does. This module is used
 * by `npm run simulate` to produce correctly signed payloads, and by the tests.
 */
export function signRetellBody(raw_body: string, api_key: string, timestamp_ms = Date.now()): string {
  const digest = crypto.createHmac('sha256', api_key).update(`${raw_body}${timestamp_ms}`, 'utf8').digest('hex');
  return `v=${timestamp_ms},d=${digest}`;
}

export function verifyRetellSignature(raw_body: string, api_key: string, header: string | undefined): boolean {
  const match = header?.match(/^v=(\d+),d=(.+)$/);
  if (!match) return false;
  const expected = Buffer.from(
    crypto.createHmac('sha256', api_key).update(`${raw_body}${match[1]}`, 'utf8').digest('hex').toLowerCase()
  );
  const actual = Buffer.from(match[2].toLowerCase());
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
