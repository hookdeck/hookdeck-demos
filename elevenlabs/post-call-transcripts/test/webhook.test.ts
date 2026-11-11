import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createApp } from '../src/server';
import { audioEvent, failureEvent, sign, transcriptionEvent } from '../src/samples';

const SECRET = 'wsec_test_secret';

describe('POST /webhooks/elevenlabs', () => {
  let server: ReturnType<ReturnType<typeof createApp>['app']['listen']>;
  let base: string;
  let ctx: ReturnType<typeof createApp>;
  let data_dir: string;

  beforeEach(async () => {
    process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
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
      headers: { 'content-type': 'application/json', 'elevenlabs-signature': sign(SECRET, raw_body), ...extra },
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

  it('shows that the forwarded body still passes the SDK constructEvent', async () => {
    await post(transcriptionEvent('conv_sdk'));
    assert.equal(ctx.store.listDeliveries()[0].sdk_check, 'ok');
  });

  it('reports a bad signature in the SDK check without blocking the (Hookdeck-verified) event', async () => {
    await post(transcriptionEvent('conv_bad'), { 'elevenlabs-signature': `t=${Math.floor(Date.now() / 1000)},v0=deadbeef` });
    assert.match(ctx.store.listDeliveries()[0].sdk_check || '', /does not match/);
    assert.equal(ctx.store.listConversations().length, 1);
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
