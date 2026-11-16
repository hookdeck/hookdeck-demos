import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { MIN_EXCHANGES, SAFETY_EXCHANGES, SCENES, canStartNext, createEndWatcher, guidanceFor, nextSceneIndex, speakerAfterMute } from '../src/story.ts';

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

test('after the mute player\'s turn the listener goes back to the first player who can speak', () => {
  const players = [{ name: 'Pixel', bot: true }, { name: 'Priya', bot: false }, { name: 'Sam', bot: false }];
  assert.equal(speakerAfterMute(players)?.name, 'Priya');
  assert.equal(speakerAfterMute([{ name: 'Pixel', bot: true }]), undefined);
});

import { addressedPlayer, cleanSpeech, moveOnVerdict, nextSpeakerIndex, onBramReply, onPlayerInput, onPlayout, onSceneStart, speechFilter, type TurnState } from '../src/story.ts';

const crew = [
  { name: 'Priya', identity: 'web-1', bot: false },
  { name: 'Sam', identity: 'web-2', bot: false },
  { name: 'Pixel', identity: 'bot-pixel', bot: true },
];

test('the next speaker is the player Bram names last, else the next in rotation', () => {
  assert.equal(addressedPlayer('The door is open. Priya, will you go through, or does Sam want to look first?', crew)?.name, 'Sam');
  assert.equal(addressedPlayer('Nobody is named here.', crew), undefined);
  assert.equal(addressedPlayer('Samuel the stranger waves.', crew), undefined); // a longer word is not Sam
  assert.equal(nextSpeakerIndex(crew, 0, 'Sam, which way?'), 1);
  assert.equal(nextSpeakerIndex(crew, 1, 'Which way do you go?'), 2);
  assert.equal(nextSpeakerIndex(crew, 2, 'Which way do you go?'), 0);
  assert.equal(nextSpeakerIndex([], 0, 'x'), -1);
});

test('next_scene is refused with no new player input, and before the minimum inputs, and a refusal is a verdict, not speech', () => {
  assert.equal(moveOnVerdict(3, false, false), 'no_new_input');
  assert.equal(moveOnVerdict(1, true, false), 'too_early');
  assert.equal(moveOnVerdict(2, true, false), 'ok');
  assert.equal(moveOnVerdict(0, true, true), 'ok'); // short mode, but still only answering an input
});

test('the speech filter removes spoken tool calls and tool names', () => {
  assert.deepEqual(cleanSpeech('We step out. functions.next_scene()'), { text: 'We step out. ', removed: true });
  assert.equal(cleanSpeech('Time for next_scene now').text, 'Time for now');
  assert.equal(cleanSpeech('functions.give_turn({player: "Sam"}) Sam, go on.').text, ' Sam, go on.');
  assert.deepEqual(cleanSpeech('Plain words only.'), { text: 'Plain words only.', removed: false });
  assert.equal(cleanSpeech('end_story, write_in_ledger and fetch_bram').text.trim(), ', and');
});

test('the speech filter works on a stream, with a tool name split across chunks', async () => {
  const removed: string[] = [];
  const chunks = ['The cave opens. ', 'functions.', 'next_', 'scene()', ' You see a ledge.'];
  const stream = new ReadableStream<string>({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
  const out: string[] = [];
  for await (const part of speechFilter((what) => removed.push(what))(stream)) out.push(part);
  const spoken = out.join('');
  assert.ok(!/next_scene|functions/.test(spoken), spoken);
  assert.ok(spoken.includes('The cave opens.') && spoken.includes('You see a ledge.'));
  assert.ok(removed.length >= 1);
});

const fresh = (): TurnState => ({ scene_index: 1, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false, short_mode: false });

test('simulation: Bram asks, nothing is heard, and then nothing happens: no turn change, no scene, no new reply', () => {
  const s = fresh();
  onBramReply(s, 'The map lies open. Priya, which way do you take?');
  assert.equal(onPlayout(s, crew)?.name, 'Priya'); // turn given after playout, to the player he named
  // ... silence: no player input arrives. The guard says no move on is possible,
  assert.equal(moveOnVerdict(s.inputs, s.input_since_call, false), 'no_new_input');
  assert.equal(s.inputs, 0);
  // and a second playout with no new reply keeps the same speaker's turn logic stable (rotation moves only on a new playout)
  assert.equal(s.rotation, 0);
});

test('simulation: only real player input counts, a scene needs two, and a call consumes the input', () => {
  const s = fresh();
  onBramReply(s, 'Priya, which way?');
  onPlayout(s, crew);
  assert.equal(moveOnVerdict(s.inputs, s.input_since_call, false), 'no_new_input');
  onPlayerInput(s); // Priya answers
  assert.equal(moveOnVerdict(s.inputs, s.input_since_call, false), 'too_early'); // one input is not enough
  onBramReply(s, 'Sam, what about you?');
  assert.equal(onPlayout(s, crew)?.name, 'Sam');
  onPlayerInput(s); // Sam answers
  assert.equal(moveOnVerdict(s.inputs, s.input_since_call, false), 'ok');
  s.input_since_call = false; // next_scene consumed it
  assert.equal(moveOnVerdict(s.inputs, s.input_since_call, false), 'no_new_input'); // a chained call is refused
  onSceneStart(s, 1);
  assert.deepEqual([s.scene_index, s.inputs, s.input_since_call], [2, 0, false]);
});

test('simulation: no turn is given before the first scene or while the story is ending', () => {
  const s = fresh();
  s.scene_index = 0;
  assert.equal(onPlayout(s, crew), undefined);
  s.scene_index = 1; s.ending = true;
  assert.equal(onPlayout(s, crew), undefined);
});

import { createLlmWatchdog, stallLine } from '../src/story.ts';

test('the watchdog fires once after 20 seconds of silence, and progress cancels it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stalls = 0;
    const w = createLlmWatchdog(() => { stalls += 1; }, 20000, { set: setTimeout, clear: clearTimeout });
    w.arm();
    assert.equal(w.armed, true);
    mock.timers.tick(19999);
    assert.equal(stalls, 0);
    mock.timers.tick(2);
    assert.equal(stalls, 1);
    assert.equal(w.armed, false);
    mock.timers.tick(60000);
    assert.equal(stalls, 1); // once

    w.arm();
    mock.timers.tick(10000);
    w.progress(); // Bram started speaking
    mock.timers.tick(60000);
    assert.equal(stalls, 1);

    w.arm(); // a new player input re-arms from zero
    mock.timers.tick(15000);
    w.arm();
    mock.timers.tick(15000);
    assert.equal(stalls, 1);
    mock.timers.tick(5001);
    assert.equal(stalls, 2);
  } finally {
    mock.timers.reset();
  }
});

test('the stall line is short, in character and names the player', () => {
  assert.match(stallLine('Priya'), /Priya/);
  assert.ok(stallLine(undefined, 1).length < 90);
  assert.notEqual(stallLine('Sam', 0), stallLine('Sam', 1));
});
