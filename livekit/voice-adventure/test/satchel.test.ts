import assert from 'node:assert/strict';
import test from 'node:test';
const { parseSatchel, ITEM_IDS, PLAIN_LABELS } = require('../public/satchel.js');

test('satchel attribute: known item ids only, broken values are empty, and every item has plain wording', () => {
  assert.deepEqual(parseSatchel('["map","sword","brass_key"]'), ['map', 'brass_key']);
  for (const v of [undefined, '', 'nope', '{"a":1}', 'null']) assert.deepEqual(parseSatchel(v), []);
  for (const id of ITEM_IDS) assert.ok(PLAIN_LABELS[id]);
});
