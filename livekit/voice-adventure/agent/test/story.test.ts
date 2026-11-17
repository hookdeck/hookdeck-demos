import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createEndWatcher, speakerAfterMute } from '../src/story.ts';

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

import { addressedPlayer, cleanSpeech, nextSpeakerIndex, onBramReply, onPlayerInput, onPlayout, speechFilter, type TurnState } from '../src/story.ts';

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

const fresh = (): TurnState => ({ scene_index: 1, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false });

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

import { LEADING_BLOCK_END, LEADING_BLOCK_START, bramInstructions } from '../src/story.ts';

// Phrasing that directs the players: offers, choices, suggestions and "would you like to" questions
const LEADING = /would you like|do you want to|you could|you might|you may want|why not|maybe you|try to|try and|how about|shall (we|you)|should you|offer|choice|suggest|search for/i;

const withoutLeadingExamples = (text: string) => text.replace(new RegExp(`${escapeRegExp(LEADING_BLOCK_START)}[\\s\\S]*?${escapeRegExp(LEADING_BLOCK_END)}`), '');
function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

import { createTurnRecovery } from '../src/story.ts';

test('turn recovery: a final transcript with no turn end commits the turn after 15 s, then says the line after 15 s more', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const log: string[] = [];
    const r = createTurnRecovery({ commit: () => log.push('commit'), say_again: () => log.push('say') }, 15000, { set: setTimeout, clear: clearTimeout });
    r.onFinalTranscript();
    mock.timers.tick(14999);
    assert.deepEqual(log, []);
    mock.timers.tick(2);
    assert.deepEqual(log, ['commit']);
    mock.timers.tick(15001);
    assert.deepEqual(log, ['commit', 'say']);
    mock.timers.tick(60000);
    assert.deepEqual(log, ['commit', 'say']); // done: nothing repeats
  } finally { mock.timers.reset(); }
});

test('turn recovery: progress (the turn ended, or the agent started thinking or speaking) cancels it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const log: string[] = [];
    const r = createTurnRecovery({ commit: () => log.push('commit'), say_again: () => log.push('say') }, 15000, { set: setTimeout, clear: clearTimeout });
    r.onFinalTranscript();
    mock.timers.tick(10000);
    r.onProgress();
    mock.timers.tick(60000);
    assert.deepEqual(log, []);
    // after a commit, progress also clears the second stage
    r.onFinalTranscript();
    mock.timers.tick(15001);
    assert.deepEqual(log, ['commit']);
    r.onProgress();
    mock.timers.tick(60000);
    assert.deepEqual(log, ['commit']);
    // a later final transcript starts over from stage zero
    r.onFinalTranscript();
    mock.timers.tick(15001);
    assert.deepEqual(log, ['commit', 'commit']);
  } finally { mock.timers.reset(); }
});



