import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoom, isStoryRoom, newRoomName, sceneAuthorized, sceneSecret } from '../src/rooms';

test('a new story gets a server-made name; arbitrary names are never accepted', () => {
  const made = chooseRoom(undefined, []);
  assert.ok('room' in made && isStoryRoom(made.room));
  assert.ok(isStoryRoom(newRoomName()));
  for (const bad of ['standup', 'story-', 'story-xyz', '../x', 'story-1234567890', 'story-abc123 ', 7, {}]) {
    const result = chooseRoom(bad, ['story-abc123']);
    assert.ok('error' in result && result.status === 404, String(bad));
  }
});

test('an invite joins only an existing open story room', () => {
  assert.deepEqual(chooseRoom('story-abc123', ['story-abc123', 'other']), { room: 'story-abc123' });
  const gone = chooseRoom('story-abc123', ['story-ffffff']);
  assert.ok('error' in gone && gone.status === 404);
  // A room that matches the pattern but that this app does not have open is not made on demand
  const none = chooseRoom('story-abc123', []);
  assert.ok('error' in none);
});

test('the number of open stories is capped', () => {
  const open = ['story-000001', 'story-000002'];
  const refused = chooseRoom(undefined, open, 2);
  assert.ok('error' in refused && refused.status === 429);
  // Joining an open one is still allowed at the cap
  assert.deepEqual(chooseRoom('story-000002', open, 2), { room: 'story-000002' });
});

test('the scene secret is checked in full, and the wrong one is refused', () => {
  const secret = 'a-test-secret-that-is-long-enough-for-hs256';
  assert.equal(sceneAuthorized(sceneSecret(secret), secret), true);
  assert.equal(sceneAuthorized(sceneSecret('another'), secret), false);
  assert.equal(sceneAuthorized(undefined, secret), false);
  assert.equal(sceneAuthorized('', secret), false);
});
