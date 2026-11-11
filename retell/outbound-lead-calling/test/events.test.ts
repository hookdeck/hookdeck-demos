import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';

process.env.LEADS_FILE = path.join(os.tmpdir(), `retell-demo-leads-${process.pid}.json`);

import { applyRetellEvent, endStatus, RetellWebhook } from '../src/events';
import { signRetellBody, verifyRetellSignature } from '../src/retell-signature';
import { addLead, getLead } from '../src/store';

function newLead(id: string) {
  addLead({
    id, name: 'Test', property_interest: '1 Test Street', notes: '', phone_masked: '+•••••••••00',
    status: 'calling', created_at: new Date().toISOString(), call_id: `call_${id}`, timeline: [],
  });
}
const payload = (event: string, id: string, extra: object = {}): RetellWebhook =>
  ({ event, call: { call_id: `call_${id}`, metadata: { lead_id: id }, ...extra } });

test('signature: HMAC-SHA256 over raw body + timestamp, round trip and tamper checks', () => {
  const header = signRetellBody('{"a":1}', 'secret_key', 1683650202360);
  // Digest computed independently: printf '%s' '{"a":1}1683650202360' | openssl dgst -sha256 -hmac secret_key
  assert.equal(header, 'v=1683650202360,d=490b0225ba07045444bb890ef2fd98fee9352863882a072f24616e9bf768fdbe');
  assert.ok(verifyRetellSignature('{"a":1}', 'secret_key', header));
  assert.ok(!verifyRetellSignature('{"a":1}', 'wrong_key', header));
  assert.ok(!verifyRetellSignature('{"a": 1}', 'secret_key', header), 'body must be byte-exact');
  assert.ok(!verifyRetellSignature('{"a":1}', 'secret_key', undefined));
});

test('lifecycle: started -> ended -> analyzed updates status and stores the analysis', () => {
  newLead('life');
  assert.equal(applyRetellEvent(payload('call_started', 'life')), 'applied');
  assert.equal(getLead('life')!.status, 'in_call');

  applyRetellEvent(payload('call_ended', 'life', { start_timestamp: 1000, end_timestamp: 61000, disconnection_reason: 'agent_hangup' }));
  assert.equal(getLead('life')!.status, 'completed');
  assert.equal(getLead('life')!.duration_seconds, 60);

  applyRetellEvent(payload('call_analyzed', 'life', {
    call_analysis: { call_summary: 'Wants a viewing', user_sentiment: 'Positive', call_successful: true, custom_analysis_data: { viewing_requested: true } },
  }));
  const lead = getLead('life')!;
  assert.equal(lead.status, 'analyzed');
  assert.equal(lead.summary, 'Wants a viewing');
  assert.equal(lead.sentiment, 'Positive');
  assert.deepEqual(lead.analysis, { viewing_requested: true });
});

test('idempotency: a repeated (event, call_id) is ignored and recorded', () => {
  newLead('dupe');
  applyRetellEvent(payload('call_ended', 'dupe', { disconnection_reason: 'user_hangup' }));
  assert.equal(applyRetellEvent(payload('call_ended', 'dupe', { disconnection_reason: 'dial_failed' })), 'duplicate');
  const lead = getLead('dupe')!;
  assert.equal(lead.status, 'completed', 'the repeat must not change the lead');
  assert.equal(lead.timeline.filter(t => t.note).length, 1);
});

test('ordering: call_analyzed arriving before call_ended is not downgraded', () => {
  newLead('order');
  applyRetellEvent(payload('call_analyzed', 'order', { call_analysis: { call_summary: 's' } }));
  applyRetellEvent(payload('call_ended', 'order', { disconnection_reason: 'user_hangup' }));
  assert.equal(getLead('order')!.status, 'analyzed');
});

test('calls that never connect: no call_started, call_ended carries the reason', () => {
  assert.equal(endStatus('dial_no_answer'), 'no_answer');
  assert.equal(endStatus('voicemail_reached'), 'no_answer');
  assert.equal(endStatus('dial_failed'), 'failed');
  assert.equal(endStatus('error_llm_websocket_open'), 'failed');
  assert.equal(endStatus('user_hangup'), 'completed');
});

test('unknown calls are acknowledged, not applied', () => {
  assert.equal(applyRetellEvent({ event: 'call_ended', call: { call_id: 'nope' } }), 'unknown_lead');
});
