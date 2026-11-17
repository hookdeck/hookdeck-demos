import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSummaryLine, decodeState, resumePlayers, SUMMARY_LINES } from '../src/resume.ts';

const players = [{ identity: 'web-1', name: 'Priya', bot: false }, { identity: 'bot-pixel', name: 'Pixel', bot: true }];

test('decode ignores empty, foreign and broken metadata', () => {
  assert.equal(decodeState(''), null);
  assert.equal(decodeState(undefined), null);
  assert.equal(decodeState('not json'), null);
  assert.equal(decodeState('{"hello":1}'), null);
});

test('resume players: named guests now in the room win; otherwise the saved humans come back', () => {
  assert.deepEqual(resumePlayers(players, [{ identity: 'web-9', name: 'Priya', bot: false }]).map((p) => p.identity), ['web-9']);
  assert.deepEqual(resumePlayers(players, [{ identity: 'web-9', name: '', bot: false }]).map((p) => p.name), ['Priya']);
});

