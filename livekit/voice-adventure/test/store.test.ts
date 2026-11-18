import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-store-'));
process.env.DATA_DIR = dir;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../src/store') as typeof import('../src/store');

const delivery = (n: number) => ({ received_at: 't', event_id: `e${n}`, verified: true, duplicate: false, headers: { authorization: 'Bearer secret-token', 'content-type': 'application/webhook+json' }, body_base64: 'e30=' });

test('a recorded delivery keeps its headers except the credential', () => {
  store.recordDelivery(delivery(1));
  const raw = fs.readFileSync(store.DELIVERIES_FILE, 'utf-8');
  assert.ok(!raw.includes('secret-token'));
  const line = JSON.parse(raw.trim().split('\n')[0]);
  assert.equal(line.headers.authorization, '[redacted]');
  assert.equal(line.headers['content-type'], 'application/webhook+json');
});

test('scrubbing redacts a file an earlier version wrote, and caps it', () => {
  const lines = Array.from({ length: store.MAX_DELIVERIES + 20 }, (_, i) => JSON.stringify(delivery(i)));
  fs.writeFileSync(store.DELIVERIES_FILE, lines.join('\n') + '\n');
  store.scrubDeliveries();
  const after = fs.readFileSync(store.DELIVERIES_FILE, 'utf-8');
  assert.ok(!after.includes('secret-token'));
  const kept = after.trim().split('\n');
  assert.equal(kept.length, store.MAX_DELIVERIES);
  assert.equal(JSON.parse(kept.at(-1)!).event_id, `e${store.MAX_DELIVERIES + 19}`);
});

test('trimming keeps the latest lines once the file holds more than twice the cap', () => {
  const file = path.join(dir, 'trim.jsonl');
  fs.writeFileSync(file, Array.from({ length: 11 }, (_, i) => `{"n":${i}}`).join('\n') + '\n');
  store.trimDeliveries(file, 5);
  assert.deepEqual(fs.readFileSync(file, 'utf-8').trim().split('\n'), ['{"n":6}', '{"n":7}', '{"n":8}', '{"n":9}', '{"n":10}']);
  store.trimDeliveries(file, 5); // 5 lines: unchanged
  assert.equal(fs.readFileSync(file, 'utf-8').trim().split('\n').length, 5);
});

test('saves are atomic: the file is replaced whole and no temporary file is left', () => {
  store.saveLog({ sessions: {} });
  store.saveChronicle({ sessions: {} });
  assert.deepEqual(store.loadLog(), { sessions: {} });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});
