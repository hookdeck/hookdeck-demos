import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planLedger, realName } from '../src/names.ts';

test('a typed name is a real name; an empty one, the identity or a placeholder is not', () => {
  assert.equal(realName('Priya', 'web-1a2b3c'), 'Priya');
  assert.equal(realName('  Sam  ', 'web-1a2b3c'), 'Sam');
  assert.equal(realName('', 'web-1a2b3c'), undefined);
  assert.equal(realName(undefined, 'web-1a2b3c'), undefined);
  assert.equal(realName('web-1a2b3c', 'web-1a2b3c'), undefined);
  assert.equal(realName('web-ff00aa', 'something-else'), undefined);
  assert.equal(realName('Player', 'web-1a2b3c'), undefined);
});

test('a player who typed a name is greeted and written in without being asked', () => {
  const plan = planLedger([{ identity: 'web-1', name: 'Priya', bot: false }], new Set());
  assert.deepEqual(plan.named, [{ identity: 'web-1', name: 'Priya', bot: false }]);
  assert.deepEqual(plan.unnamed, []);
});

test('only players who joined without a name are asked, in the order she meets them', () => {
  const plan = planLedger([
    { identity: 'web-1', name: '', bot: false },
    { identity: 'web-2', name: 'Sam', bot: false },
    { identity: 'web-3', name: undefined, bot: false },
  ], new Set());
  assert.deepEqual(plan.named.map((g) => g.name), ['Sam']);
  assert.deepEqual(plan.unnamed, ['web-1', 'web-3']);
});

test('a second player joining later is planned the same way, and guests already in the ledger are skipped', () => {
  const guests = [
    { identity: 'web-1', name: 'Priya', bot: false },
    { identity: 'web-2', name: 'Sam', bot: false },
  ];
  const plan = planLedger(guests, new Set(['web-1']));
  assert.deepEqual(plan.named.map((g) => g.name), ['Sam']);
  assert.deepEqual(plan.unnamed, []);
});

test('the bot has a known name from its identity and is never asked', () => {
  const plan = planLedger([{ identity: 'bot-pixel', name: '', bot: true }], new Set());
  assert.deepEqual(plan.named, [{ identity: 'bot-pixel', name: 'Pixel', bot: true }]);
  assert.deepEqual(plan.unnamed, []);
});
