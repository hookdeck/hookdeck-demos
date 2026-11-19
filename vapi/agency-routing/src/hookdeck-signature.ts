// Generated from `_shared/hookdeck/hookdeck-signature.ts`; edit there and run `npm run sync-shared`.
/**
 * Verifies the `x-hookdeck-signature` header Event Gateway adds to every delivery.
 *
 * The signature is the base64 HMAC-SHA256 of the raw request body, keyed with the project
 * signing secret (HOOKDECK_SIGNING_SECRET, copied from the dashboard into .env). It has no
 * timestamp on purpose: Event Gateway verified the sender's own signature when it accepted
 * the request, so a retry or replay hours later is legitimate and must still pass.
 *
 * While a rolled secret is still active, Hookdeck also sends `x-hookdeck-signature-2`.
 *
 * Reference: https://hookdeck.com/docs/authentication#hookdeck-webhook-signature-verification
 */
import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'crypto';

export const HOOKDECK_SECRETS_URL = 'https://dashboard.hookdeck.com/settings/project/secrets';

/** The project signing secret from HOOKDECK_SIGNING_SECRET. Exits with a hint when it isn't set. */
export function requireHookdeckSigningSecret(): string {
  const secret = process.env.HOOKDECK_SIGNING_SECRET;
  if (!secret || secret.startsWith('your_')) {
    console.error('❌ HOOKDECK_SIGNING_SECRET is not set. Add the project signing secret to .env');
    console.error(`   (Hookdeck dashboard: Project settings -> Secrets, ${HOOKDECK_SECRETS_URL}).`);
    process.exit(1);
  }
  return secret;
}

/** The signature Hookdeck sends for a body: base64 HMAC-SHA256 of the raw bytes. */
export function signHookdeckBody(raw_body: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(raw_body).digest('base64');
}

function sameSignature(expected: string, received: string): boolean {
  const expected_bytes = Buffer.from(expected, 'utf8');
  const received_bytes = Buffer.from(received, 'utf8');
  // timingSafeEqual throws on different lengths, so check the length first
  return expected_bytes.length === received_bytes.length && timingSafeEqual(expected_bytes, received_bytes);
}

/**
 * True when `signature_header` (x-hookdeck-signature) matches the raw body signed with `secret`.
 * Pass `signature_header_2` (x-hookdeck-signature-2) to also accept the previous secret's signature.
 */
export function verifyHookdeckSignature(
  raw_body: Buffer | string,
  signature_header: string | undefined,
  secret: string | undefined,
  signature_header_2?: string,
): boolean {
  if (!secret) return false;
  const expected = signHookdeckBody(raw_body, secret);
  return [signature_header, signature_header_2].some((header) => Boolean(header) && sameSignature(expected, header as string));
}
