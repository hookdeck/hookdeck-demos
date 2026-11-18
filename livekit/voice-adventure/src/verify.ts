import { WebhookReceiver } from 'livekit-server-sdk';
import { RETRY_WINDOW_S } from './config';

/**
 * How late a retry or a replay can arrive and still be accepted: the connection's whole retry window plus a
 * margin. LiveKit signs each webhook once, with a token that expires 5 minutes later, and Event Gateway forwards
 * that original `Authorization` header on every retry, so a retry after 5 minutes carries an expired token.
 *
 * Trade-off: with a WEBHOOK source the app is the only verifier, so this accepts a captured request for as long as
 * the tolerance. The signature and the `sha256` claim (the hash of the body) are still checked, so the body can't be
 * altered, and the app applies events idempotently on the event id, so a replay changes nothing. The proper fix is
 * the LIVEKIT source type: Event Gateway then checks the token when it receives the request, and the app relies on that.
 */
export const CLOCK_TOLERANCE_S = RETRY_WINDOW_S + 300;

/** Verifies a LiveKit webhook (signature, body hash, and expiry within the tolerance). Throws when it fails. */
export function verifyWebhook(receiver: WebhookReceiver, body: string, authorization: string | undefined) {
  return receiver.receive(body, authorization, false, CLOCK_TOLERANCE_S);
}
