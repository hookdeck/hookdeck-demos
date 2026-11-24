import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSoundtrackKeeper, type IngressApi, type IngressLike } from '../src/soundtrack-keeper';
import { soundtrackReachable } from '../src/soundtracks';

function fake(reachable = true, open = true) {
  const store: IngressLike[] = [];
  const calls: string[] = [];
  let n = 0;
  let clock = 1000;
  const ingresses: IngressApi = {
    async list(room) { return store.filter((i) => i.roomName === room); },
    async create(o) { calls.push(`create ${o.name}`); const i = { ingressId: `IN_${++n}`, name: o.name, roomName: o.room, state: { status: 2 } }; store.push(i); return i; },
    async remove(id) { calls.push(`remove ${id}`); store.splice(store.findIndex((i) => i.ingressId === id), 1); },
  };
  const keeper = createSoundtrackKeeper({ ingresses, reachable: async () => reachable, room_open: async () => open, url_of: (s) => `https://x.test/${s}.ogg`, now: () => clock });
  return { store, calls, keeper, tick: (ms: number) => { clock += ms; } };
}

test('arriving in a scene whose soundtrack is playing keeps it; a new scene replaces it', async () => {
  const { keeper, calls } = fake();
  assert.deepEqual(await keeper.ensure('story-aaaaaa', 'tavern'), { ok: true, ingress_id: 'IN_1' });
  assert.equal((await keeper.ensure('story-aaaaaa', 'tavern')).kept, true);
  assert.equal((await keeper.ensure('story-aaaaaa', 'forest')).ok, true);
  assert.deepEqual(calls, ['create scene:tavern', 'remove IN_1', 'create scene:forest']);
});

test('a soundtrack whose ingress has ended is started again, on arrival or on the ingress_ended webhook', async () => {
  const { keeper, store, calls, tick } = fake();
  await keeper.ensure('story-aaaaaa', 'tavern');
  tick(180000);
  store[0].state = { status: 4 }; // ENDPOINT_COMPLETE
  assert.equal(await keeper.onEnded('story-aaaaaa', 'scene:tavern'), 'restarted');
  assert.deepEqual(calls, ['create scene:tavern', 'remove IN_1', 'create scene:tavern']);
  // On arrival: the second one ended too
  tick(180000);
  store[0].state = { status: 4 };
  const again = await keeper.ensure('story-aaaaaa', 'tavern');
  assert.equal(again.ok && !again.kept, true);
});

test('no restart after the story ended, for another scene, for a file that failed at once or in a closed room', async () => {
  const a = fake();
  await a.keeper.ensure('story-aaaaaa', 'tavern');
  await a.keeper.stop('story-aaaaaa');
  a.tick(180000);
  assert.equal(await a.keeper.onEnded('story-aaaaaa', 'scene:tavern'), 'ignored');
  const b = fake();
  await b.keeper.ensure('story-aaaaaa', 'forest');
  b.tick(180000);
  assert.equal(await b.keeper.onEnded('story-aaaaaa', 'scene:tavern'), 'ignored'); // the ended one is an old scene's
  const c = fake();
  await c.keeper.ensure('story-aaaaaa', 'cave');
  c.tick(5000);
  assert.equal(await c.keeper.onEnded('story-aaaaaa', 'scene:cave'), 'ignored'); // 5 s: failed, not finished
  const d = fake(true, false);
  await d.keeper.ensure('story-aaaaaa', 'cave');
  d.tick(180000);
  assert.equal(await d.keeper.onEnded('story-aaaaaa', 'scene:cave'), 'ignored');
});

test('a soundtrack that can not be fetched makes no ingress and says why, so nobody is told there is music', async () => {
  const { keeper, calls } = fake(false);
  const result = await keeper.ensure('story-aaaaaa', 'cave');
  assert.equal(result.ok, false);
  assert.match(result.reason!, /can't be fetched/);
  assert.deepEqual(calls, []);
});

test('the reachability check is a HEAD request, falls back to a ranged GET, and fails on an error or a timeout', async () => {
  const seen: string[] = [];
  const answer = (status: number): typeof fetch => (async (_url: any, init: any) => { seen.push(`${init?.method ?? 'GET'}:${status}`); return new Response(null, { status }); }) as any;
  assert.equal(await soundtrackReachable('https://x.test/a.ogg', answer(200)), true);
  assert.equal(await soundtrackReachable('https://x.test/a.ogg', answer(404)), false);
  assert.equal(await soundtrackReachable('https://x.test/a.ogg', (async () => { throw new Error('down'); }) as any), false);
  assert.equal(await soundtrackReachable('https://x.test/a.ogg', (async (_u: any, init: any) => new Response(null, { status: init?.method === 'HEAD' ? 405 : 206 })) as any), true);
  assert.deepEqual(seen, ['HEAD:200', 'HEAD:404']);
});

test('a late ingress_ended for the scene just replaced does not restart it or delete the new scene', async () => {
  const store: IngressLike[] = [];
  const calls: string[] = [];
  let n = 0;
  let clock = 1000;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const ingresses: IngressApi = {
    async list(room) { return store.filter((i) => i.roomName === room); },
    async create(o) { await sleep(30); calls.push(`create ${o.name}`); const i = { ingressId: `IN_${++n}`, name: o.name, roomName: o.room, state: { status: 2 } }; store.push(i); return i; },
    async remove(id) { calls.push(`remove ${id}`); store.splice(store.findIndex((i) => i.ingressId === id), 1); },
  };
  const keeper = createSoundtrackKeeper({ ingresses, reachable: async () => true, room_open: async () => true, url_of: (s) => `https://x.test/${s}.ogg`, now: () => clock });
  await keeper.ensure('story-aaaaaa', 'tavern');
  clock += 69000;
  // The scene changes; the webhook for the deleted tavern ingress arrives while the forest ingress is still being created
  const change = keeper.ensure('story-aaaaaa', 'forest');
  await sleep(10);
  const late = keeper.onEnded('story-aaaaaa', 'scene:tavern');
  assert.equal(await late, 'ignored');
  assert.equal((await change).ok, true);
  assert.deepEqual(calls, ['create scene:tavern', 'remove IN_1', 'create scene:forest']);
  assert.deepEqual(store.map((i) => i.name), ['scene:forest']);
});
