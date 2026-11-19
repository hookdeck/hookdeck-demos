import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createApp } from '../src/server';
import { Store } from '../src/store';
import { signHookdeckBody } from '../src/hookdeck-signature';
import { audioEvent, failureEvent, sign, transcriptionEvent } from '../src/samples';

const SECRET = 'wsec_test_secret';
const SIGNING_SECRET = 'test-hookdeck-signing-secret';

describe('POST /webhooks/elevenlabs', () => {
  let server: ReturnType<ReturnType<typeof createApp>['app']['listen']>;
  let base: string;
  let ctx: ReturnType<typeof createApp>;
  let data_dir: string;

  beforeEach(async () => {
    process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
    process.env.HOOKDECK_SIGNING_SECRET = SIGNING_SECRET;
    data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-demo-'));
    ctx = createApp(data_dir);
    server = ctx.app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    server.close();
    fs.rmSync(data_dir, { recursive: true, force: true });
  });

  async function post(payload: object, extra: Record<string, string> = {}) {
    const raw_body = JSON.stringify(payload);
    return fetch(`${base}/webhooks/elevenlabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'elevenlabs-signature': sign(SECRET, raw_body), 'x-hookdeck-signature': signHookdeckBody(raw_body, SIGNING_SECRET), ...extra },
      body: raw_body,
    });
  }

  it('stores a transcription with its analysis and outcome', async () => {
    const event = transcriptionEvent('conv_1');
    assert.equal((await post(event)).status, 200);

    const [record] = ctx.store.listConversations();
    assert.equal(record.conversation_id, 'conv_1');
    assert.equal(record.outcome, 'success');
    assert.equal(record.transcript.length, 4);
    assert.equal(record.data_collection_results.caller_name.value, 'Sam');
    assert.equal(record.summary, 'Sam booked a haircut for Friday at 3pm.');
  });

  it('stores an event once when it arrives twice', async () => {
    const event = transcriptionEvent('conv_dup');
    await post(event);
    await post(event);

    assert.equal(ctx.store.listConversations().length, 1);
    assert.deepEqual(
      ctx.store.listDeliveries().map((d) => d.result),
      ['duplicate', 'stored'],
    );
  });

  it('merges audio into the conversation whichever arrives first', async () => {
    await post(audioEvent('conv_audio', 'agent_demo', Buffer.from('mp3-bytes')));
    await post(transcriptionEvent('conv_audio'));

    const [record] = ctx.store.listConversations();
    assert.equal(record.audio_bytes, 9);
    assert.equal(record.outcome, 'success');
    assert.equal(fs.readFileSync(ctx.store.audioPath('conv_audio')).toString(), 'mp3-bytes');
  });

  it('records a call that failed to start', async () => {
    await post(failureEvent('conv_fail'));
    const [record] = ctx.store.listConversations();
    assert.equal(record.outcome, 'failed_to_start');
    assert.equal(record.failure_reason, 'no-answer');
  });

  it('answers 500 while fail_next is set, then recovers and stores the retry', async () => {
    ctx.failure.fail_next = 1;
    const event = transcriptionEvent('conv_retry');

    assert.equal((await post(event)).status, 500);
    assert.equal(ctx.store.listConversations().length, 0);

    assert.equal((await post(event)).status, 200);
    assert.equal(ctx.store.listConversations().length, 1);
    assert.deepEqual(
      ctx.store.listDeliveries().map((d) => d.result),
      ['stored', 'simulated_failure'],
    );
  });

  it('acknowledges event types it does not store', async () => {
    const response = await post({ type: 'voice_removed', event_timestamp: 1, data: { voice_id: 'v' } });
    assert.equal(response.status, 200);
    assert.equal(ctx.store.listConversations().length, 0);
  });

  it('answers 401 and records the delivery when x-hookdeck-signature is missing, wrong, or for another body', async () => {
    const raw_body = JSON.stringify(transcriptionEvent('conv_unsigned'));
    const send = (signature?: string) => fetch(`${base}/webhooks/elevenlabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-hookdeck-signature': signature } : {}) },
      body: raw_body,
    });
    assert.equal((await send()).status, 401);
    assert.equal((await send(signHookdeckBody(raw_body, 'wrong-secret'))).status, 401);
    assert.equal((await send(signHookdeckBody(raw_body + ' ', SIGNING_SECRET))).status, 401);
    assert.equal(ctx.store.listConversations().length, 0);
    const deliveries = ctx.store.listDeliveries();
    assert.equal(deliveries.length, 3);
    assert.ok(deliveries.every((d) => d.result === 'signature_rejected' && d.status_code === 401));
  });

  it('accepts a replay of an old event: the Hookdeck signature has no timestamp', async () => {
    const raw_body = JSON.stringify(transcriptionEvent('conv_old'));
    const response = await fetch(`${base}/webhooks/elevenlabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'elevenlabs-signature': sign(SECRET, raw_body, 1_600_000_000), 'x-hookdeck-signature': signHookdeckBody(raw_body, SIGNING_SECRET) },
      body: raw_body,
    });
    assert.equal(response.status, 200);
  });
});

describe('the demo app\'s own routes', () => {
  let server: ReturnType<ReturnType<typeof createApp>['app']['listen']>;
  let port: number;
  let ctx: ReturnType<typeof createApp>;
  let data_dir: string;

  beforeEach(async () => {
    delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    process.env.HOOKDECK_SIGNING_SECRET = SIGNING_SECRET;
    data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-demo-'));
    ctx = createApp(data_dir);
    server = ctx.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => {
    server.close();
    fs.rmSync(data_dir, { recursive: true, force: true });
  });
  // fetch will not set Host, so use http.request
  function request(method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, text }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('answers a request whose Host is not localhost (DNS rebinding) with 403', async () => {
    assert.equal((await request('GET', '/api/conversations', { host: 'evil.example' })).status, 403);
    assert.equal((await request('GET', '/api/conversations', { host: `localhost:${port}` })).status, 200);
    assert.equal((await request('GET', '/api/conversations', { host: `127.0.0.1:${port}` })).status, 200);
  });

  it('needs the x-demo header on the state-changing routes', async () => {
    for (const route of ['/api/reset', '/api/fail-next', '/api/signed-url']) {
      assert.equal((await request('POST', route)).status, 403, route);
      assert.equal((await request('POST', route, { 'content-type': 'text/plain' })).status, 403, route);
    }
    assert.equal(ctx.failure.fail_next, 0);
    const ok = await request('POST', '/api/fail-next', { 'x-demo': '1', 'content-type': 'application/json' }, '{"count":2}');
    assert.equal(ok.status, 200);
    assert.equal(ctx.failure.fail_next, 2);
    assert.equal((await request('POST', '/api/reset', { 'x-demo': '1' })).status, 200);
  });

  it('answers a malformed body with a JSON error and no stack trace or path', async () => {
    const res = await request('POST', '/webhooks/elevenlabs', { 'content-type': 'application/json', 'x-hookdeck-signature': signHookdeckBody('{"type":', SIGNING_SECRET) }, '{"type":');
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.text), { error: 'bad request' });
  });

  async function hook(payload: unknown) {
    const body = JSON.stringify(payload);
    const res = await request('POST', '/webhooks/elevenlabs', { 'content-type': 'application/json', 'x-hookdeck-signature': signHookdeckBody(body, SIGNING_SECRET) }, body);
    return res.status;
  }

  it('answers an event with the wrong shape with 400, logs it, and stores nothing', async () => {
    const bad = [
      { type: 'post_call_audio', data: { conversation_id: 'c1', agent_id: 'a', full_audio: 123 } },
      { type: 'post_call_audio', data: { conversation_id: 'c1', agent_id: 'a' } },
      { type: 'post_call_transcription', data: { conversation_id: { x: 1 }, agent_id: 'a' } },
      { type: 'post_call_transcription', data: { conversation_id: 'x'.repeat(500), agent_id: 'a' } },
    ];
    for (const payload of bad) assert.equal(await hook(payload), 400, JSON.stringify(payload).slice(0, 60));
    assert.equal(ctx.store.listConversations().length, 0);
    assert.equal(ctx.store.listDeliveries().length, bad.length);
    assert.ok(ctx.store.listDeliveries().every((d) => d.status_code === 400 && d.result === 'invalid_payload'));
  });

  it('coerces odd fields on write so the page can render them', async () => {
    const event: any = transcriptionEvent('conv_odd');
    event.data.transcript = 'not an array';
    event.data.analysis.data_collection_results = ['x'];
    event.data.analysis.evaluation_criteria_results = 'x';
    event.data.analysis.transcript_summary = { a: 1 };
    event.data.metadata.call_duration_secs = '<img src=x onerror=alert(1)>';
    event.data.metadata.start_time_unix_secs = '1700000000';
    assert.equal(await hook(event), 200);
    const [record] = ctx.store.listConversations();
    assert.deepEqual(record.transcript, []);
    assert.deepEqual(record.data_collection_results, {});
    assert.deepEqual(record.evaluation_criteria_results, {});
    assert.equal(record.summary, undefined);
    assert.equal(record.call_duration_secs, undefined);
    assert.equal(record.start_time_unix_secs, 1700000000);
    event.data.metadata.call_duration_secs = '42';
    const other: any = transcriptionEvent('conv_odd2');
    other.data.metadata.call_duration_secs = '42';
    await hook(other);
    assert.equal(ctx.store.getConversation('conv_odd2')!.call_duration_secs, 42);
  });
});

describe('Store', () => {
  let data_dir: string;
  beforeEach(() => { data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-store-')); });
  afterEach(() => fs.rmSync(data_dir, { recursive: true, force: true }));

  it('gives conversation IDs that differ only by punctuation their own audio files', () => {
    const store = new Store(data_dir);
    assert.notEqual(store.audioPath('a/b'), store.audioPath('a_b'));
    assert.notEqual(store.audioPath('a/b'), store.audioPath('a.b'));
    assert.ok(store.audioPath('../../x').startsWith(path.join(data_dir, 'audio')));
    store.apply(audioEvent('a/b', 'agent', Buffer.from('one')) as any, 1);
    store.apply(audioEvent('a_b', 'agent', Buffer.from('two')) as any, 1);
    assert.equal(fs.readFileSync(store.audioPath('a/b')).toString(), 'one');
    assert.equal(fs.readFileSync(store.audioPath('a_b')).toString(), 'two');
  });

  it('keeps the newest 50 conversations and deletes the older ones\' audio', () => {
    const store = new Store(data_dir);
    for (let i = 0; i < 52; i++) {
      store.apply(transcriptionEvent(`conv_${i}`) as any, 1);
      store.apply(audioEvent(`conv_${i}`, 'agent', Buffer.from('x')) as any, 1);
    }
    assert.equal(store.listConversations().length, 50);
    assert.equal(store.getConversation('conv_0'), undefined);
    assert.equal(fs.existsSync(store.audioPath('conv_0')), false);
    assert.equal(fs.existsSync(store.audioPath('conv_51')), true);
    assert.equal(fs.readdirSync(path.join(data_dir, 'audio')).length, 50);
  });

  it('writes state atomically and reloads it', () => {
    const store = new Store(data_dir);
    store.apply(transcriptionEvent('conv_keep') as any, 1);
    assert.deepEqual(fs.readdirSync(data_dir).filter((f) => f.endsWith('.tmp')), []);
    assert.equal(new Store(data_dir).listConversations()[0].conversation_id, 'conv_keep');
  });

  it('moves a corrupt state file aside instead of starting empty over it', () => {
    fs.writeFileSync(path.join(data_dir, 'state.json'), '{"conversations": [');
    const error = console.error;
    console.error = () => {};
    try {
      assert.equal(new Store(data_dir).listConversations().length, 0);
    } finally {
      console.error = error;
    }
    const aside = fs.readdirSync(data_dir).filter((f) => f.startsWith('state.corrupt-'));
    assert.equal(aside.length, 1);
    assert.equal(fs.readFileSync(path.join(data_dir, aside[0]), 'utf-8'), '{"conversations": [');
  });
});

describe('ElevenLabs-Signature format', () => {
  it('is t=<unix seconds>,v0=<hex HMAC-SHA256 of "<t>.<raw body>">', async () => {
    const raw_body = JSON.stringify(transcriptionEvent('conv_format'));
    const header = sign(SECRET, raw_body, 1_700_000_000);
    assert.match(header, /^t=1700000000,v0=[0-9a-f]{64}$/);

    const elevenlabs = new ElevenLabsClient({ apiKey: 'webhook-only' });
    // Outside the SDK's 30-minute tolerance
    await assert.rejects(elevenlabs.webhooks.constructEvent(raw_body, header, SECRET), /tolerance/);
  });
});
