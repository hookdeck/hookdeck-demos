import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScene, SCENES, soundtrackUrl } from '../src/soundtracks';

test('soundtrack URLs default to the repository, and can be overridden for a host or one scene', () => {
  assert.equal(soundtrackUrl('cave', {}), 'https://raw.githubusercontent.com/hookdeck/hookdeck-demos/main/livekit/voice-adventure/public/soundtracks/cave.ogg');
  assert.equal(soundtrackUrl('cave', { SOUNDTRACK_BASE_URL: 'https://example.test/audio/' }), 'https://example.test/audio/cave.ogg');
  assert.equal(soundtrackUrl('cave', { SOUNDTRACK_BASE_URL: 'https://example.test/audio', SOUNDTRACK_URL_CAVE: 'https://other.test/c.ogg' }), 'https://other.test/c.ogg');
});

test('only the four known scenes are accepted', () => {
  assert.deepEqual([...SCENES], ['tavern', 'forest', 'cave', 'finale']);
  assert.ok(isScene('forest'));
  assert.ok(!isScene('dragon') && !isScene(undefined));
});
