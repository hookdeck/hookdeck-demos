import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRoomWatcher } from '../src/empty-room.ts';

function fake() {
  const pending = new Map<number, () => void>();
  let n = 0;
  return {
    timers: { set: ((fn: () => void) => { pending.set(++n, fn); return n; }) as any, clear: ((id: number) => { pending.delete(id); }) as any },
    fire: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    pending,
  };
}

test('the last human leaving ends the story once the grace period has passed', () => {
  const f = fake();
  let ended = 0;
  const watcher = createEmptyRoomWatcher(() => { ended += 1; }, 10000, f.timers);
  watcher.update(1);
  assert.equal(f.pending.size, 0);
  watcher.update(0);
  watcher.update(0); // a second event doesn't arm a second timer
  assert.equal(f.pending.size, 1);
  f.fire();
  assert.equal(ended, 1);
});

test('a human who comes back within the grace period cancels it', () => {
  const f = fake();
  let ended = 0;
  const watcher = createEmptyRoomWatcher(() => { ended += 1; }, 10000, f.timers);
  watcher.update(0);
  watcher.update(1);
  f.fire();
  assert.equal(ended, 0);
});
