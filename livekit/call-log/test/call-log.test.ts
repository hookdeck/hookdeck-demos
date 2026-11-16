import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import * as crypto from 'crypto';
import { applyEvent, emptyLog, summarise, LiveKitEvent } from '../src/call-log';

const T0 = 1_800_000_000; // seconds
const room = { sid: 'RM_abc', name: 'support-1', creationTime: T0 };
const ev = (id: string, event: string, at: number, extra: object = {}): LiveKitEvent => ({ id, event, createdAt: at, room, ...extra });

const events: LiveKitEvent[] = [
  ev('e1', 'room_started', T0),
  ev('e2', 'participant_joined', T0 + 2, { participant: { identity: 'alice', name: 'Alice', joinedAt: T0 + 2 } }),
  ev('e3', 'participant_joined', T0 + 5, { participant: { identity: 'bob', joinedAt: T0 + 5 } }),
  ev('e4', 'egress_started', T0 + 6, { egressInfo: { egressId: 'EG_1', roomId: 'RM_abc', roomName: 'support-1', status: 'EGRESS_STARTING', startedAt: (T0 + 6) * 1e9 } }),
  ev('e5', 'participant_left', T0 + 60, { participant: { identity: 'bob', joinedAt: T0 + 5 } }),
  ev('e6', 'egress_ended', T0 + 62, { egressInfo: { egressId: 'EG_1', roomId: 'RM_abc', status: 'EGRESS_COMPLETE', startedAt: (T0 + 6) * 1e9, endedAt: (T0 + 62) * 1e9, fileResults: [{ filename: 'call.mp4', location: 'https://bucket.example/call.mp4', duration: 56e9 }] } }),
  ev('e7', 'participant_left', T0 + 63, { participant: { identity: 'alice', joinedAt: T0 + 2 } }),
  ev('e8', 'room_finished', T0 + 65),
];

function build(order: LiveKitEvent[]) {
  const log = emptyLog();
  for (const e of order) applyEvent(log, e);
  return summarise(log);
}

test('builds a call from a clean sequence', () => {
  const [call] = build(events);
  assert.equal(call.status, 'ended');
  assert.equal(call.duration_s, 65);
  assert.deepEqual(Object.keys(call.participants).sort(), ['alice', 'bob']);
  assert.equal(call.participants.bob.left_at, (T0 + 60) * 1000);
  assert.equal(call.recordings.EG_1.status, 'EGRESS_COMPLETE');
  assert.equal(call.recordings.EG_1.links[0].url, 'https://bucket.example/call.mp4');
});

test('duplicates are ignored', () => {
  const log = emptyLog();
  for (const e of events) applyEvent(log, e);
  const again = applyEvent(log, events[1]);
  assert.equal(again.duplicate, true);
  assert.deepEqual(summarise(log), build(events));
});

test('reverse order produces the same call log', () => {
  const forward = build(events)[0];
  const backward = build([...events].reverse())[0];
  assert.deepEqual({ ...backward, event_ids: [] }, { ...forward, event_ids: [] });
});

test('a late egress_updated does not move a finished recording backwards', () => {
  const late = ev('e9', 'egress_updated', T0 + 70, { egressInfo: { egressId: 'EG_1', status: 'EGRESS_ACTIVE' } });
  const [call] = build([...events, late]);
  assert.equal(call.recordings.EG_1.status, 'EGRESS_COMPLETE');
});

test('a call with no room_finished is in progress', () => {
  const [call] = build(events.slice(0, 3));
  assert.equal(call.status, 'in progress');
  assert.equal(call.duration_s, undefined);
});

test('WebhookReceiver accepts a signed body and rejects a changed one', async () => {
  const key = 'APItest', secret = 'a-test-secret-that-is-long-enough-for-hs256';
  const body = JSON.stringify(events[0]);
  const token = new AccessToken(key, secret);
  token.sha256 = crypto.createHash('sha256').update(body).digest('base64');
  const jwt = await token.toJwt();
  const receiver = new WebhookReceiver(key, secret);
  assert.equal((await receiver.receive(body, jwt)).event, 'room_started');
  await assert.rejects(receiver.receive(body + ' ', jwt));
});

test('a minted token joins one room, can publish, expires and carries no secret', async () => {
  const { TokenVerifier } = await import('livekit-server-sdk');
  const { mintToken } = await import('../src/token');
  const key = 'APItest', secret = 'a-test-secret-that-is-long-enough-for-hs256';
  const jwt = await mintToken(key, secret, 'room-1', 'web-abc');
  const claims = await new TokenVerifier(key, secret).verify(jwt);
  assert.equal(claims.sub, 'web-abc');
  assert.equal(claims.video?.room, 'room-1');
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.canPublish, true);
  assert.ok(claims.exp! - claims.nbf! <= 600 + 5);
  assert.ok(!jwt.includes(secret));
  // The room configuration dispatches the story agent by name
  assert.equal((claims as any).roomConfig?.agents?.[0]?.agentName, 'story-gm');
});
