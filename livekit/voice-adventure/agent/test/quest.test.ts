import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS, endAllowed, itemsHere, newQuest, normalizeItem, parseNameCorrection, parseSatchel, questNote, satchelAttribute, shortModeQuest, takeItem, useItem, usesName } from '../src/quest.ts';
import { buildState, decodeState, encodeState, recapInstructions } from '../src/resume.ts';
import { sceneHint, sceneStartNote, TOOL_NAMES, cleanSpeech } from '../src/story.ts';

test('items start where the quest puts them; the flint and wick appear only once the chest is open', () => {
  const q = newQuest();
  assert.deepEqual(itemsHere(q, 1).map((i) => i.id), ['map']);
  assert.deepEqual(itemsHere(q, 2).map((i) => i.id), ['brass_key']);
  assert.deepEqual(itemsHere(q, 3).map((i) => i.id), ['lantern']);
  assert.deepEqual(itemsHere(q, 4), []);
  q.chest_open = true;
  assert.deepEqual(itemsHere(q, 4).map((i) => i.id), ['flint_and_wick']);
  assert.equal(ITEMS.length, 4);
});

test('take_item: right scene works; wrong scene, twice, the chest and unknown things are refused with a reason', () => {
  const q = newQuest();
  assert.equal(takeItem(q, 1, 'the salt-stained map').ok, true);
  assert.deepEqual(q.satchel, ['map']);
  assert.match(takeItem(q, 1, 'map').message, /already in the satchel/);
  assert.match(takeItem(q, 1, 'brass key').message, /not in this place/);
  assert.match(takeItem(q, 1, 'chest').message, /too heavy/);
  assert.match(takeItem(q, 1, 'sword').message, /no "sword" here/);
  assert.equal(takeItem(q, 2, 'key').ok, true);
  assert.match(takeItem(q, 4, 'flint').message, /still locked/);
});

test('use_item: the chest without a key, with the key, and in the wrong place', () => {
  const q = newQuest();
  assert.match(useItem(q, 1, 'brass key', 'chest').message, /does not open without a key/);
  assert.match(useItem(q, 2, 'brass key', 'chest').message, /no chest in this place|not in the satchel|does not open/);
  takeItem(q, 2, 'key');
  assert.match(useItem(q, 2, 'key', 'chest').message, /no chest in this place/);
  const ok = useItem(q, 4, 'key', 'chest');
  assert.equal(ok.ok, true);
  assert.equal(q.chest_open, true);
  assert.match(useItem(q, 4, 'key', 'chest').message, /already open/);
});

test('use_item: an item that is not carried is refused', () => {
  const q = newQuest();
  assert.match(useItem(q, 4, 'lantern', 'flint and wick').message, /not carrying the Lantern/);
  assert.match(useItem(q, 1, 'map', 'door').message, /not in the satchel/);
});

test('the finale gate: the lantern lights only at the lighthouse with flint and wick, and only then may the story end', () => {
  const q = shortModeQuest();
  assert.equal(endAllowed(q), false);
  assert.match(useItem(q, 4, 'lantern', 'flint and wick').message, /no flint and wick/);
  assert.equal(useItem(q, 4, 'key', 'chest').ok, true);
  assert.equal(takeItem(q, 4, 'flint and wick').ok, true);
  assert.match(useItem(q, 3, 'flint', 'lantern').message, /not the place/);
  assert.equal(endAllowed(q), false);
  const lit = useItem(q, 4, 'flint and wick', 'lantern');
  assert.equal(lit.event, 'lit');
  assert.equal(endAllowed(q), true);
});

test('the satchel survives a save and a resume', () => {
  const q = newQuest();
  takeItem(q, 1, 'map');
  takeItem(q, 2, 'key');
  q.chest_open = true;
  const json = encodeState(buildState({ scene_index: 4, players: [{ identity: 'web-1', name: 'Priya', bot: false }], summary: [], quest: q }));
  const back = decodeState(json)!;
  assert.deepEqual(back.quest, { satchel: ['map', 'brass_key'], chest_open: true, lantern_lit: false });
  assert.deepEqual(parseSatchel(satchelAttribute(q)), ['map', 'brass_key']);
  assert.deepEqual(parseSatchel('nonsense'), []);
  assert.match(recapInstructions(back, back.players), /In the satchel: the salt-stained map; the small brass key/);
  // old saved state without a quest still loads
  assert.equal(decodeState(JSON.stringify({ v: 1, scene_index: 1, players: [], clues: [], summary: [], ended: false, saved_at: 1 }))!.quest, undefined);
});

test('the scene note lists what lies here, what is carried and the open puzzle, and never tells players to act', () => {
  const q = newQuest();
  const arrival = sceneStartNote(0, 'with its soundtrack', q);
  assert.match(arrival, /not yet taken: the salt-stained map/);
  assert.match(arrival, /In the satchel: nothing/);
  assert.match(arrival, /chest is here and locked; it cannot be opened yet/);
  assert.match(arrival, /never tell the players to take it/);
  takeItem(q, 1, 'map');
  const later = sceneHint(1, false, { replies_in_scene: 1, described: [], quest: q });
  assert.match(later, /Nothing here is left to take/);
  assert.match(later, /In the satchel: the salt-stained map/);
  const finale = questNote({ satchel: ['brass_key', 'lantern'], chest_open: false, lantern_lit: false }, 4);
  assert.match(finale, /locked; the party carries a key/);
  assert.match(sceneHint(4, false, { replies_in_scene: 1, described: [], quest: newQuest() }), /never call end_story before that/);
});

test('names: items and the new tool names are normalised and kept out of speech', () => {
  assert.equal(normalizeItem('The Brass Key'), 'brass_key');
  assert.equal(normalizeItem('flint'), 'flint_and_wick');
  assert.equal(normalizeItem('iron chest'), 'chest');
  assert.ok(TOOL_NAMES.includes('take_item') && TOOL_NAMES.includes('use_item'));
  assert.equal(cleanSpeech('You pick it up. take_item("key") and go').removed, true);
});

test('names: a correction is parsed, the speaker name check finds a reply that uses it', () => {
  assert.equal(parseNameCorrection("I'm Snaggle."), 'Snaggle');
  assert.equal(parseNameCorrection('my name is Priya'), 'Priya');
  assert.equal(parseNameCorrection("I'm going to the door"), undefined);
  assert.equal(parseNameCorrection("I'm ready"), undefined);
  assert.equal(parseNameCorrection('I look at the map'), undefined);
  assert.equal(usesName('Snaggle, the way is before you.', 'Snaggle'), true);
  assert.equal(usesName('The way is before you.', 'Snaggle'), false);
  assert.equal(usesName('anything', undefined), false);
});
