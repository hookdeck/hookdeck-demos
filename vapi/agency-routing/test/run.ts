/**
 * Offline test: posts sample Vapi messages to each client's route (as Hookdeck would deliver
 * them) and checks routing plus the async tool's Live Call Control request, using a local
 * stand-in for Vapi's controlUrl. No accounts needed.
 */
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';

process.env.LOOKUP_DELAY_MS = '50';
process.env.ACME_ASSISTANT_ID = 'asst-acme';
process.env.GLOBEX_ASSISTANT_ID = 'asst-globex';

import { createApp, logs } from '../src/server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const control_requests: any[] = [];
  const control = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { control_requests.push({ url: req.url, body: JSON.parse(body) }); res.end('{"status":"ok"}'); });
  }).listen(0);
  const control_port = (control.address() as AddressInfo).port;

  const app = createApp().listen(0);
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;
  const post = (path: string, message: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });

  const tool_calls = (assistant_id: string, name: string) => ({
    type: 'tool-calls',
    call: { id: `call-${assistant_id}`, assistantId: assistant_id, monitor: { controlUrl: `http://localhost:${control_port}/${assistant_id}/control` } },
    toolCallList: [{ id: `tc-${assistant_id}`, type: 'function', function: { name: 'lookup_customer', arguments: { customer_name: name } } }],
  });

  // 1. status-update and end-of-call-report land on the right client
  assert.equal((await post('/clients/acme/webhook', { type: 'status-update', status: 'in-progress', call: { id: 'c1', assistantId: 'asst-acme' } })).status, 200);
  assert.equal((await post('/clients/globex/webhook', { type: 'end-of-call-report', endedReason: 'customer-ended-call', call: { id: 'c2', assistantId: 'asst-globex' } })).status, 200);
  assert.equal(logs.acme[0].type, 'status-update');
  assert.equal(logs.globex[0].type, 'end-of-call-report');

  // 2. an async tool call is acknowledged straight away, then the result goes to the call's controlUrl
  const started = Date.now();
  const res = await post('/clients/acme/webhook', tool_calls('asst-acme', 'Priya Shah'));
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 40, 'webhook must be answered before the slow work finishes');
  assert.equal(control_requests.length, 0);
  await sleep(300);
  assert.equal(control_requests.length, 1);
  assert.equal(control_requests[0].url, '/asst-acme/control');
  assert.equal(control_requests[0].body.type, 'add-message');
  assert.equal(control_requests[0].body.triggerResponseEnabled, true);
  assert.match(control_requests[0].body.message.content, /Dr Lee/);

  // 3. a redelivery of the same tool call does not run twice
  await post('/clients/acme/webhook', tool_calls('asst-acme', 'Priya Shah'));
  await sleep(200);
  assert.equal(control_requests.length, 1);

  // 4. each client has its own CRM
  await post('/clients/globex/webhook', tool_calls('asst-globex', 'Ken'));
  await sleep(300);
  assert.match(control_requests[1].body.message.content, /Quote 3380/);

  // 5. a message for another client's assistant is not processed
  await post('/clients/globex/webhook', tool_calls('asst-acme', 'Priya Shah'));
  assert.equal(logs.globex[0].type, 'misrouted');

  // 6. failure injection: the next N deliveries get 503, per client; tool calls are spared unless asked for
  const set_chaos = (slug: string, body: object) => fetch(`${base}/api/chaos/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const status_update = { type: 'status-update', status: 'in-progress', call: { id: 'c3', assistantId: 'asst-acme' } };
  await set_chaos('acme', { fail_next: 2 });
  assert.equal((await post('/clients/globex/webhook', { ...status_update, call: { id: 'c3', assistantId: 'asst-globex' } })).status, 200, 'other client unaffected');
  assert.equal((await post('/clients/acme/webhook', tool_calls('asst-acme', 'Priya Shah'))).status, 200, 'tool calls are spared by default');
  assert.equal((await post('/clients/acme/webhook', status_update)).status, 503);
  assert.equal((await post('/clients/acme/webhook', status_update)).status, 503);
  assert.equal((await post('/clients/acme/webhook', status_update)).status, 200, 'back to normal after N failures');
  await set_chaos('acme', { fail_next: 1, include_tool_calls: true });
  assert.equal((await post('/clients/acme/webhook', tool_calls('asst-acme', 'Priya Shah'))).status, 503);
  await set_chaos('acme', {});

  console.log('All checks passed');
  app.close(); control.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
