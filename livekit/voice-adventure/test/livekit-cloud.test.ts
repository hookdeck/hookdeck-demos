import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_WEBHOOK_NAME, findWebhook, resolveProjectId, resolveSession } from '../scripts/livekit-cloud';

const NOW = 1_800_000_000;
const config = (expiry: number, extra = '') => `default_user: u2
users:
  - id: u1
    session_token: tok-one
    session_expiry: ${NOW + 1000}
  - id: u2
    email: a@example.com
    session_token: tok-two
    session_expiry: ${expiry}
${extra}`;

test('LIVEKIT_SESSION_TOKEN wins', () => {
  assert.equal(resolveSession({ LIVEKIT_SESSION_TOKEN: 'env-tok' }, config(NOW + 5), NOW)?.token, 'env-tok');
});

test('uses the default user\'s unexpired session and the default API URL', () => {
  const s = resolveSession({}, config(NOW + 5), NOW);
  assert.equal(s?.token, 'tok-two');
  assert.equal(s?.api_url, 'https://beta-api.livekit.cloud');
});

test('skips an expired session, a missing file and bad YAML', () => {
  assert.equal(resolveSession({}, config(NOW - 1), NOW), undefined);
  assert.equal(resolveSession({}, undefined, NOW), undefined);
  assert.equal(resolveSession({}, ': : [', NOW), undefined);
});

test('honours a per-user api_url', () => {
  const s = resolveSession({}, config(NOW + 5, '    api_url: https://api.example.test/\n'), NOW);
  assert.equal(s?.api_url, 'https://api.example.test');
});

const projects = [
  { id: 'p_1', url: 'wss://other-abc.livekit.cloud' },
  { id: 'p_2', subdomain: 'mine-xyz' },
  { id: 'p_3', url: 'https://third.livekit.cloud' },
];

test('matches LIVEKIT_URL by url, by subdomain, and lets LIVEKIT_PROJECT_ID override', () => {
  assert.equal(resolveProjectId({ LIVEKIT_URL: 'wss://other-abc.livekit.cloud' }, projects), 'p_1');
  assert.equal(resolveProjectId({ LIVEKIT_URL: 'wss://mine-xyz.livekit.cloud' }, projects), 'p_2');
  assert.equal(resolveProjectId({ LIVEKIT_URL: 'wss://third.livekit.cloud' }, projects), 'p_3');
  assert.equal(resolveProjectId({ LIVEKIT_URL: 'wss://nope.livekit.cloud' }, projects), undefined);
  assert.equal(resolveProjectId({ LIVEKIT_URL: 'wss://nope.livekit.cloud', LIVEKIT_PROJECT_ID: 'p_9' }, projects), 'p_9');
});

test('finds the webhook that already points at the Hookdeck source', () => {
  const list = [{ id: 'w1', url: 'https://x.test' }, { id: 'w2', url: 'https://hkdk.events/abc' }];
  assert.equal(findWebhook(list, 'https://hkdk.events/abc')?.id, 'w2');
  assert.equal(findWebhook(list, 'https://hkdk.events/zzz'), undefined);
});

test('a webhook created under the old demo name is found even though its URL changed', () => {
  const list: any[] = [{ id: 'w9', name: LEGACY_WEBHOOK_NAME, url: 'https://hkdk.events/old' }];
  assert.equal(findWebhook(list, 'https://hkdk.events/new')?.id, 'w9');
});
