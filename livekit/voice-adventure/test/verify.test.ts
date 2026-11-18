import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import * as crypto from 'crypto';
import { CLOCK_TOLERANCE_S, verifyWebhook } from '../src/verify';
import { RETRY_WINDOW_S } from '../src/config';

const key = 'APItest', secret = 'a-test-secret-that-is-long-enough-for-hs256';
const body = JSON.stringify({ id: 'e1', event: 'room_started', createdAt: 1_800_000_000 });
const receiver = new WebhookReceiver(key, secret);

/** A webhook token the way LiveKit signs it, issued `age_s` seconds ago and valid for 5 minutes. */
async function signed(age_s: number, signing_secret = secret, hash_of = body) {
  const issued = Math.floor(Date.now() / 1000) - age_s;
  const token = new AccessToken(key, signing_secret, { ttl: 300 });
  token.sha256 = crypto.createHash('sha256').update(hash_of).digest('base64');
  // The SDK stamps nbf/exp from now: rewrite the claims to the issue time
  const [header, payload] = (await token.toJwt()).split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  Object.assign(claims, { nbf: issued, exp: issued + 300 });
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', signing_secret).update(`${header}.${encoded}`).digest('base64url');
  return `${header}.${encoded}.${sig}`;
}

test('the tolerance covers the connection\'s whole retry window (8 attempts from 30 s)', () => {
  assert.equal(RETRY_WINDOW_S, 30 * (2 ** 8 - 1));
  assert.ok(CLOCK_TOLERANCE_S > RETRY_WINDOW_S);
});

test('an expired token is refused by the SDK default but accepted within the tolerance', async () => {
  const late = await signed(RETRY_WINDOW_S);
  await assert.rejects(receiver.receive(body, late), /exp/);
  assert.equal((await verifyWebhook(receiver, body, late)).event, 'room_started');
});

test('a token older than the tolerance, a wrong signature and a changed body are all refused', async () => {
  await assert.rejects(verifyWebhook(receiver, body, await signed(CLOCK_TOLERANCE_S + 300 + 60)));
  await assert.rejects(verifyWebhook(receiver, body, await signed(RETRY_WINDOW_S, 'another-secret-that-is-long-enough-for-hs256')));
  await assert.rejects(verifyWebhook(receiver, body + ' ', await signed(10)));
});
