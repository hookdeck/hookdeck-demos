import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { SCENES, createEndWatcher, nextSceneIndex, speakerAfterMute } from '../src/story.ts';

test('short mode jumps from the first scene to the finale, and normal mode goes in order', () => {
  assert.equal(nextSceneIndex(1, true), SCENES.length - 1);
  assert.equal(nextSceneIndex(1, false), 1);
  assert.equal(nextSceneIndex(0, true), 0);
  assert.equal(nextSceneIndex(2, true), 2);
});

test('every scene but the finale describes concrete ways out', () => {
  for (const s of SCENES.slice(0, -1)) assert.ok(s.onward.length > 20, s.scene);
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
  assert.equal(moveOnVerdict(s.input_since_call), 'no_new_input');
  assert.equal(s.inputs, 0);
  // and a second playout with no new reply keeps the same speaker's turn logic stable (rotation moves only on a new playout)
  assert.equal(s.rotation, 0);
});

test('simulation: one player input that chooses to leave is accepted, and a call consumes the input', () => {
  const s = fresh();
  onBramReply(s, 'Priya, the stranger is waiting.');
  onPlayout(s, crew);
  assert.equal(moveOnVerdict(s.input_since_call), 'no_new_input'); // nobody has spoken yet
  onPlayerInput(s); // Priya says "we leave by the north door"
  assert.equal(moveOnVerdict(s.input_since_call), 'ok'); // one input is enough: no minimum
  s.input_since_call = false; // next_scene consumed it
  assert.equal(moveOnVerdict(s.input_since_call), 'no_new_input'); // a chained call is refused
  onSceneStart(s, 1);
  assert.deepEqual([s.scene_index, s.inputs, s.input_since_call], [2, 0, false]);
});

test('there is no nudge and no minimum: many inputs never force a scene change', () => {
  const s = fresh();
  for (let i = 0; i < 12; i++) { onPlayerInput(s); s.input_since_call = false; }
  assert.equal(s.scene_index, 1); // still the same scene
  assert.equal(moveOnVerdict(s.input_since_call), 'no_new_input');
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

import { LEADING_BLOCK_END, LEADING_BLOCK_START, bramInstructions, sceneHint, sceneStartNote } from '../src/story.ts';

// Phrasing that directs the players: offers, choices, suggestions and "would you like to" questions
const LEADING = /would you like|do you want to|you could|you might|you may want|why not|maybe you|try to|try and|how about|shall (we|you)|should you|offer|choice|suggest|search for/i;

const withoutLeadingExamples = (text: string) => text.replace(new RegExp(`${escapeRegExp(LEADING_BLOCK_START)}[\\s\\S]*?${escapeRegExp(LEADING_BLOCK_END)}`), '');
function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

test('the scene note has no offer, choice or suggestion phrasing, for every scene and for the ending', () => {
  for (let i = 0; i <= SCENES.length; i++) assert.doesNotMatch(sceneHint(i, false), LEADING, `scene ${i}`);
  assert.doesNotMatch(sceneHint(2, true), LEADING);
  for (let i = 0; i < SCENES.length; i++) assert.doesNotMatch(sceneStartNote(i, 'with its soundtrack'), LEADING, `start note ${i}`);
});

test('the scene data describes only: no scene text suggests an action', () => {
  for (const s of SCENES) assert.doesNotMatch([s.place, s.sights, s.onward, s.clue].join(' '), LEADING, s.scene);
});

test('the instructions describe, end without a tacked-on name, reveal clues on investigation, and keep bad examples apart', () => {
  const text = bramInstructions([{ name: 'Priya', bot: false }, { name: 'Pixel', bot: true }]);
  assert.match(text, /Describe, don't direct/);
  assert.match(text, /A small iron chest sits under the bench, its lock rusted shut\./);
  assert.match(text, /Reveal a clue only when a player investigates that thing/);
  assert.match(text, /one gentle nudge about something to look at, never the solution/);
  assert.match(text, /what the players actually try, including the unexpected/);
  assert.match(text, /Never tack a name or a question onto the end \("Priya\?", "What do you do\?"\)/);
  assert.match(text, /only the names of the travellers listed above, never a name from an example/);
  // the leading lines appear only inside the marked block of examples
  assert.ok(LEADING.test(text) && text.includes(LEADING_BLOCK_START));
  assert.doesNotMatch(withoutLeadingExamples(text), LEADING);
  // no pacing pressure
  assert.doesNotMatch(text, /nudge the group|move on yet|enough exploring|time to move on/i);
});

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
