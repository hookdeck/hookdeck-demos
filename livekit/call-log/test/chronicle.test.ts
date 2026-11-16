import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChronicle, emptyChronicle, viewChronicle } from '../src/chronicle';
import { LiveKitEvent } from '../src/call-log';

const T0 = 1_800_000_000;
const room = { sid: 'RM_story', name: 'story-1', creationTime: T0 };
const ev = (id: string, event: string, at: number, extra: object = {}): LiveKitEvent => ({ id, event, createdAt: at, room, ...extra });
// Payload shapes as recorded from LiveKit Cloud: a player has no `kind` (STANDARD is the default), the agent
// is AGENT, a soundtrack ingress is INGRESS. Ingress events have no `room`, only `ingressInfo` with the room's name and sid.
const player = (identity: string, name: string) => ({ identity, name, joinedAt: T0 + 1 });
const agent = { identity: 'agent-AJ_1', kind: 'AGENT', attributes: { 'lk.agent.name': 'story-gm' }, joinedAt: T0 + 3 };
const sound = { identity: 'soundtrack-tavern', name: 'Soundtrack: tavern', kind: 'INGRESS', joinedAt: T0 + 10 };
const ingress = (id: string, event: string, at: number, state: object): LiveKitEvent =>
  ({ id, event, createdAt: at, ingressInfo: { ingressId: 'IN_1', name: 'scene:tavern', roomName: 'story-1', state } });

const events: LiveKitEvent[] = [
  ev('e1', 'room_started', T0),
  ev('e2', 'participant_joined', T0 + 1, { participant: player('web-a', 'Priya') }),
  ev('e3', 'participant_joined', T0 + 3, { participant: agent }),
  ev('e4', 'participant_joined', T0 + 4, { participant: player('web-b', 'Sam') }),
  ev('e5', 'participant_joined', T0 + 10, { participant: sound }),
  ingress('e6', 'ingress_started', T0 + 10, { status: 'ENDPOINT_PUBLISHING', startedAt: String((T0 + 10) * 1e9) }),
  ingress('e7', 'ingress_ended', T0 + 34, { status: 'ENDPOINT_COMPLETE', roomId: 'RM_story', startedAt: String((T0 + 10) * 1e9), endedAt: String((T0 + 34) * 1e9) }),
  ev('e8', 'participant_connection_aborted', T0 + 40, { participant: { ...player('web-b', 'Sam') } }),
  ev('e9', 'participant_left', T0 + 60, { participant: { ...player('web-a', 'Priya'), disconnectReason: 'CLIENT_INITIATED' } }),
  ev('e10', 'participant_left', T0 + 61, { participant: { ...agent, disconnectReason: 'CLIENT_INITIATED' } }),
  ev('e11', 'room_finished', T0 + 90),
];

const build = (order: LiveKitEvent[]) => {
  const c = emptyChronicle();
  for (const e of order) applyChronicle(c, e);
  return viewChronicle(c);
};

test('tells players, the game master and soundtracks apart from the payload kind', () => {
  const [view] = build(events);
  assert.deepEqual(view.players.sort(), ['Priya', 'Sam']);
  const text = view.lines.map((l) => l.text);
  assert.ok(text.includes('The game master joined'));
  assert.ok(text.includes('Priya joined'));
  // the soundtrack is a scene, not a person
  assert.ok(!text.some((t) => /Soundtrack: tavern joined/.test(t)));
  assert.ok(text.includes('Scene 1, Tavern: soundtrack started'));
  assert.ok(text.includes('Scene 1, Tavern: soundtrack ended after 24 s'));
});

test('a dropped connection and the session length are in the chronicle', () => {
  const [view] = build(events);
  assert.ok(view.lines.some((l) => l.kind === 'drop' && l.text === 'Sam dropped (connection aborted)'));
  assert.equal(view.status, 'ended');
  assert.equal(view.length_s, 90);
  assert.ok(view.lines.at(-1)!.text.startsWith('The session ended, 1 min 30 s long'));
});

test('duplicates and reverse order give the same chronicle, in one session', () => {
  const forward = build(events);
  const reversed = build([...events].reverse());
  const doubled = build([...events, ...events]);
  assert.equal(forward.length, 1);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(doubled, forward);
});
