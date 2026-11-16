import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSummaryLine, buildState, decodeState, encodeState, recapInstructions, resumePlayers, shouldResume, STATE_MAX_CHARS, SUMMARY_LINES } from '../src/resume.ts';

const players = [{ identity: 'web-1', name: 'Priya', bot: false }, { identity: 'bot-pixel', name: 'Pixel', bot: true }];

test('state round-trips through room metadata and stays small', () => {
  let summary: string[] = [];
  for (let i = 0; i < 20; i++) summary = addSummaryLine(summary, 'Bram', 'x'.repeat(400));
  assert.equal(summary.length, SUMMARY_LINES);
  const json = encodeState(buildState({ scene_index: 2, players, summary }, 1000));
  assert.ok(json.length < STATE_MAX_CHARS);
  const back = decodeState(json)!;
  assert.equal(back.scene_index, 2);
  assert.equal(back.players[0].name, 'Priya');
  assert.equal(back.clues.length, 2);
  assert.ok(back.summary.every((l) => l.length <= 170));
});

test('decode ignores empty, foreign and broken metadata', () => {
  assert.equal(decodeState(''), null);
  assert.equal(decodeState(undefined), null);
  assert.equal(decodeState('not json'), null);
  assert.equal(decodeState('{"hello":1}'), null);
});

test('resume branch: only a story under way and not ended is picked up', () => {
  assert.equal(shouldResume(null), false);
  assert.equal(shouldResume(buildState({ scene_index: 0, players, summary: [] })), false);
  assert.equal(shouldResume(buildState({ scene_index: 1, players, summary: [] })), true);
  assert.equal(shouldResume(buildState({ scene_index: 3, players, summary: [], ended: true })), false);
});

test('resume players: named guests now in the room win; otherwise the saved humans come back', () => {
  assert.deepEqual(resumePlayers(players, [{ identity: 'web-9', name: 'Priya', bot: false }]).map((p) => p.identity), ['web-9']);
  assert.deepEqual(resumePlayers(players, [{ identity: 'web-9', name: '', bot: false }]).map((p) => p.name), ['Priya']);
});

test('recap instructions name the scene, the players and the recent lines, and forbid a new scene', () => {
  const s = buildState({ scene_index: 2, players, summary: ['Priya: I look at the footprints'] });
  const text = recapInstructions(s, players);
  assert.match(text, /scene 2 of 4/);
  assert.match(text, /Priya/);
  assert.match(text, /footprints/);
  assert.match(text, /Do not start a new scene/);
});
