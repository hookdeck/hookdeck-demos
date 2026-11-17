import assert from 'node:assert/strict';
import test from 'node:test';

const { derive, SHOW_FOR_MS } = require('../public/while-you-wait.js') as {
  derive: (events: any[], now: number, delay_ms: number) => any;
  SHOW_FOR_MS: number;
};

const T0 = Date.parse('2026-11-17T14:02:19.000Z');
const at = (offset_ms: number) => new Date(T0 + offset_ms).toISOString();
const DETAIL = 'lookup_customer({"customer_name":"Priya Shah"}) controlUrl:present';
const tool = (offset_ms: number, call_id = 'call-1', detail = DETAIL) => ({ at: at(offset_ms), type: 'tool-calls', call_id, detail });
const result = (offset_ms: number, call_id = 'call-1') => ({ at: at(offset_ms), type: 'live-call-control', call_id, detail: 'add-message sent for tc-1: Priya Shah (555-0101): Next appointment...' });
const newest_first = (...events: any[]) => events.reverse();

test('nothing to show before any lookup, or for other tools and other message types', () => {
  assert.equal(derive([], T0, 6000), null);
  assert.equal(derive(newest_first({ at: at(0), type: 'status-update', call_id: 'call-1', detail: 'status=in-progress' }), T0, 6000), null);
  assert.equal(derive(newest_first(tool(0, 'call-1', 'reschedule_appointment({}) controlUrl:present')), T0, 6000), null);
});

test('while the CRM delay runs: the countdown and progress follow the time since the tool request', () => {
  const w = derive(newest_first(tool(0)), T0 + 2000, 6000);
  assert.equal(w.state, 'lookup');
  assert.equal(w.customer, 'Priya Shah');
  assert.equal(w.remaining_ms, 4000);
  assert.ok(Math.abs(w.progress - 1 / 3) < 1e-9);
});

test('after the delay and before the result is posted: sending, countdown at zero', () => {
  const w = derive(newest_first(tool(0)), T0 + 6500, 6000);
  assert.equal(w.state, 'sending');
  assert.equal(w.remaining_ms, 0);
  assert.equal(w.progress, 1);
});

test('the live-call-control entry completes the lookup and names the control mode', () => {
  const w = derive(newest_first(tool(0), result(6100)), T0 + 7000, 6000);
  assert.equal(w.state, 'done');
  assert.equal(w.mode, 'add-message');
  assert.equal(Date.parse(new Date(w.result_at).toISOString()), T0 + 6100);
});

test('a lookup-error entry for the same call marks the lookup failed', () => {
  const failed = { at: at(6100), type: 'lookup-error', call_id: 'call-1', detail: 'add-message failed: controlUrl responded 404: not found' };
  const w = derive(newest_first(tool(0), failed), T0 + 7000, 6000);
  assert.equal(w.state, 'failed');
  assert.match(w.error, /controlUrl responded 404/);
});

test('a redelivered tool request does not restart the lookup, and a result for another call is ignored', () => {
  const w = derive(newest_first(tool(0), tool(3000), result(6100, 'call-2')), T0 + 4000, 6000);
  assert.equal(w.state, 'lookup');
  assert.equal(w.started_at, T0);
});

test('a second lookup in the same call after the first finished starts a new one', () => {
  const w = derive(newest_first(tool(0), result(6100), tool(20000)), T0 + 22000, 6000);
  assert.equal(w.state, 'lookup');
  assert.equal(w.started_at, T0 + 20000);
});

test('a finished lookup stays on screen for a minute, an old unfinished one is dropped', () => {
  assert.notEqual(derive(newest_first(tool(0), result(6100)), T0 + 6100 + SHOW_FOR_MS - 1, 6000), null);
  assert.equal(derive(newest_first(tool(0), result(6100)), T0 + 6100 + SHOW_FOR_MS + 1, 6000), null);
  assert.equal(derive(newest_first(tool(0)), T0 + SHOW_FOR_MS + 6001, 6000), null);
});
