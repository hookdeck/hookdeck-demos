import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseLedger } = require('../public/ledger.js');

test('ledger: identity to name, trimmed and limited to strings', () => {
  assert.deepEqual(parseLedger('{"web-1":" Priya ","bot-x":3,"web-2":""}'), { 'web-1': 'Priya' });
});
test('ledger: missing, broken or non-object values are an empty ledger', () => {
  for (const v of [undefined, '', 'nope', '[1]', 'null', '"x"']) assert.deepEqual(parseLedger(v), {});
});
