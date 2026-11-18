import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';

process.env.LEADS_FILE = path.join(os.tmpdir(), `retell-demo-retry-${process.pid}.json`);

import { applyRetellEvent, RetellWebhook } from '../src/events';
import { MAX_ATTEMPTS, RETRY_DELAY_SECONDS, isMissedCall, isRetryDue, planRetry } from '../src/retry';
import { simulatedCallId } from '../src/simulated';
import { addLead, getLead, updateLead } from '../src/store';

function newLead(id: string) {
  addLead({
    id, name: 'Test', property_interest: '1 Test Street', notes: '', phone_masked: 'simulated', simulated: true,
    status: 'calling', created_at: new Date().toISOString(), call_id: simulatedCallId({ id, attempt: 1 }), timeline: [],
  });
}
const ended = (id: string, call_id: string, reason: string): RetellWebhook =>
  ({ event: 'call_ended', call: { call_id, metadata: { lead_id: id }, disconnection_reason: reason } });

test('only a call the lead did not pick up is retried', () => {
  for (const reason of ['dial_no_answer', 'dial_busy', 'voicemail_reached']) assert.ok(isMissedCall(reason), reason);
  for (const reason of ['user_hangup', 'agent_hangup', 'dial_failed', 'error_llm_websocket_open', undefined]) assert.ok(!isMissedCall(reason), String(reason));
  assert.deepEqual(planRetry(1, 'user_hangup'), {});
  assert.deepEqual(planRetry(1, 'dial_failed'), {});
});

test('planRetry: the next attempt is one step later, and the last miss gives up', () => {
  const now = Date.parse('2026-11-17T14:00:00Z');
  const first = planRetry(undefined, 'dial_no_answer', now);
  assert.equal(first.attempt, 2);
  assert.equal(first.next_attempt_at, new Date(now + RETRY_DELAY_SECONDS * 1000).toISOString());
  assert.equal(planRetry(2, 'dial_busy', now).attempt, 3);
  assert.deepEqual(planRetry(MAX_ATTEMPTS, 'voicemail_reached', now), { attempt: MAX_ATTEMPTS, next_attempt_at: undefined, gave_up: true });
});

test('isRetryDue: false before the countdown ends, true at and after it', () => {
  const at = '2026-11-17T14:02:00.000Z';
  assert.ok(!isRetryDue({ next_attempt_at: undefined }));
  assert.ok(!isRetryDue({ next_attempt_at: at }, Date.parse(at) - 1));
  assert.ok(isRetryDue({ next_attempt_at: at }, Date.parse(at)));
});

test('ladder: two misses schedule attempts 2 and 3, the third miss gives up', () => {
  newLead('ladder');
  assert.equal(applyRetellEvent(ended('ladder', 'simulated_ladder', 'dial_no_answer')), 'applied');
  let lead = getLead('ladder')!;
  assert.equal(lead.status, 'no_answer');
  assert.equal(lead.attempt, 2);
  assert.ok(lead.next_attempt_at && !lead.gave_up);

  // The page rings attempt 2: the schedule is cleared and the new call has its own id
  updateLead('ladder', { status: 'calling', next_attempt_at: undefined, call_id: simulatedCallId(lead) });
  assert.equal(applyRetellEvent(ended('ladder', 'simulated_ladder_2', 'voicemail_reached')), 'applied');
  lead = getLead('ladder')!;
  assert.equal(lead.attempt, 3);
  assert.ok(lead.next_attempt_at);

  updateLead('ladder', { status: 'calling', next_attempt_at: undefined, call_id: simulatedCallId(lead) });
  assert.equal(applyRetellEvent(ended('ladder', 'simulated_ladder_3', 'dial_no_answer')), 'applied');
  lead = getLead('ladder')!;
  assert.equal(lead.gave_up, true);
  assert.equal(lead.next_attempt_at, undefined);
  assert.equal(lead.attempt, MAX_ATTEMPTS);
});

test('ladder: an answered second attempt stops retrying and analyzes normally', () => {
  newLead('answered');
  applyRetellEvent(ended('answered', 'simulated_answered', 'dial_no_answer'));
  updateLead('answered', { status: 'calling', next_attempt_at: undefined, call_id: 'simulated_answered_2' });
  applyRetellEvent(ended('answered', 'simulated_answered_2', 'agent_hangup'));
  applyRetellEvent({ event: 'call_analyzed', call: { call_id: 'simulated_answered_2', metadata: { lead_id: 'answered' }, call_analysis: { call_summary: 'Wants a viewing' } } });
  const lead = getLead('answered')!;
  assert.equal(lead.status, 'analyzed');
  assert.equal(lead.attempt, 2);
  assert.equal(lead.next_attempt_at, undefined);
  assert.ok(!lead.gave_up);
});

test('idempotency is per call: the same event for a new attempt is applied, a repeat for the same call is not', () => {
  newLead('percall');
  applyRetellEvent(ended('percall', 'simulated_percall', 'dial_no_answer'));
  assert.equal(applyRetellEvent(ended('percall', 'simulated_percall', 'dial_no_answer')), 'duplicate');
  assert.equal(getLead('percall')!.attempt, 2, 'a repeat must not advance the ladder again');
  updateLead('percall', { status: 'calling', next_attempt_at: undefined, call_id: 'simulated_percall_2' });
  assert.equal(applyRetellEvent(ended('percall', 'simulated_percall_2', 'dial_no_answer')), 'applied');
  assert.equal(getLead('percall')!.attempt, 3);
});

test('simulatedCallId: attempt 1 keeps the demo id, later attempts get their own', () => {
  assert.equal(simulatedCallId({ id: 'abc', attempt: undefined }), 'simulated_abc');
  assert.equal(simulatedCallId({ id: 'abc', attempt: 1 }), 'simulated_abc');
  assert.equal(simulatedCallId({ id: 'abc', attempt: 3 }), 'simulated_abc_3');
});

test('a bad RETRY_DELAY_SECONDS falls back to the default', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (value: string) => execFileSync(process.execPath, ['--require', 'ts-node/register', '-e', "console.log(require('./src/retry').RETRY_DELAY_SECONDS)"], { env: { ...process.env, RETRY_DELAY_SECONDS: value }, cwd: path.join(__dirname, '..') }).toString().trim();
  assert.equal(run('abc'), '120');
  assert.equal(run('-5'), '120');
  assert.equal(run('30'), '30');
});
