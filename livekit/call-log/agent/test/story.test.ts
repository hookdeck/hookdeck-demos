import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { MIN_EXCHANGES, SAFETY_EXCHANGES, SCENES, canStartNext, createEndWatcher, guidanceFor, nextSceneIndex } from '../src/story.ts';

test('a scene has 2 or 3 open exchanges, then offers a way on, and nudges at the safety limit', () => {
  assert.equal(MIN_EXCHANGES, 2);
  assert.equal(SAFETY_EXCHANGES, 5);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(guidanceFor), ['open', 'open', 'offer_choice', 'offer_choice', 'offer_choice', 'nudge', 'nudge']);
});

test('the next scene waits for the minimum exchanges, except in short mode', () => {
  assert.equal(canStartNext(1, false), false);
  assert.equal(canStartNext(2, false), true);
  assert.equal(canStartNext(0, true), true);
});

test('short mode jumps from the first scene to the finale, and normal mode goes in order', () => {
  assert.equal(nextSceneIndex(1, true), SCENES.length - 1);
  assert.equal(nextSceneIndex(1, false), 1);
  assert.equal(nextSceneIndex(0, true), 0);
  assert.equal(nextSceneIndex(2, true), 2);
});

test('every scene but the finale names concrete ways onward', () => {
  for (const s of SCENES.slice(0, -1)) assert.ok(s.onward.includes(' or '), s.scene);
  assert.equal(SCENES.at(-1)!.onward, '');
});

test('the ending waits for the last speech to finish and a 2 second pause, and a late speech cancels it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let finished = 0;
    const w = createEndWatcher(() => { finished += 1; }, 2000, { set: setTimeout, clear: clearTimeout });
    w.onAgentState('thinking', 'listening'); // before end_story: ignored
    mock.timers.tick(5000);
    assert.equal(finished, 0);
    w.arm();
    w.onAgentState('speaking', 'listening'); // the closing finished
    mock.timers.tick(1500);
    w.onAgentState('listening', 'thinking'); // the tool result starts a farewell: cancel the pause
    mock.timers.tick(3000);
    assert.equal(finished, 0);
    w.onAgentState('speaking', 'listening'); // the farewell finished
    mock.timers.tick(1999);
    assert.equal(finished, 0);
    mock.timers.tick(2);
    assert.equal(finished, 1);
    w.onAgentState('speaking', 'listening');
    mock.timers.tick(5000);
    assert.equal(finished, 1); // only once
  } finally {
    mock.timers.reset();
  }
});
