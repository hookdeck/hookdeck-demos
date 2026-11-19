/**
 * Offline test: posts sample Vapi messages to each client's route (as Hookdeck would deliver
 * them) and checks routing plus the async tool's Live Call Control request, using a local
 * stand-in for Vapi's controlUrl. No accounts needed.
 */
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';

process.env.LOOKUP_DELAY_MS = '50';
process.env.ALLOW_LOCAL_CONTROL_URL = 'true'; // the stand-in controlUrl below is http://localhost
process.env.ACME_ASSISTANT_ID = 'asst-acme';
process.env.GLOBEX_ASSISTANT_ID = 'asst-globex';
process.env.HOOKDECK_SIGNING_SECRET = 'test-signing-secret';

import { createApp, logs } from '../src/server';
import { assertControlUrl } from '../src/live-call-control';
import { signHookdeckBody } from '../src/hookdeck-signature';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const control_requests: any[] = [];
  const control = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      control_requests.push({ url: req.url, body: JSON.parse(body) });
      // /flaky answers 500 the first time, so a redelivery has something to retry
      if (req.url?.startsWith('/flaky') && control_requests.filter((r) => r.url?.startsWith('/flaky')).length === 1) { res.writeHead(500).end('try again'); return; }
      res.end('{"status":"ok"}');
    });
  }).listen(0);
  const control_port = (control.address() as AddressInfo).port;

  const app = createApp().listen(0);
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;
  // Posts the way Event Gateway delivers: the raw body with its Hookdeck signature
  const signed_post = (path: string, body: string) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hookdeck-signature': signHookdeckBody(body, process.env.HOOKDECK_SIGNING_SECRET as string) }, body });
  const post = (path: string, message: unknown) => signed_post(path, JSON.stringify({ message }));

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

  // 1b. a delivery without a valid Hookdeck signature is refused, recorded, and starts no work
  const unsigned_body = JSON.stringify({ message: tool_calls('asst-acme', 'Priya Shah') });
  const logs_before = logs.acme.length;
  const missing = await fetch(base + '/clients/acme/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: unsigned_body });
  assert.equal(missing.status, 401);
  const forged = await fetch(base + '/clients/acme/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hookdeck-signature': signHookdeckBody(unsigned_body, 'wrong-secret') }, body: unsigned_body });
  assert.equal(forged.status, 401);
  assert.equal(logs.acme[0].type, 'signature-rejected');
  assert.equal(logs.acme.length, logs_before + 2);
  const rejected = (await (await fetch(`${base}/api/deliveries`)).json()).filter((d: any) => d.status_code === 401);
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].type, 'rejected \u00b7 bad Hookdeck signature');

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
  assert.equal(logs.acme[0].type, 'tool-calls-duplicate', 'the repeat is logged with its own type');

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

  // 7. the topology pane's feeds: each delivery the app answered, by client, and each result posted into a call
  const delivered = await (await fetch(`${base}/api/deliveries`)).json();
  assert.ok(delivered.some((d: any) => d.client === 'acme' && d.type === 'tool-calls \u00b7 lookup_customer' && d.status_code === 200));
  assert.ok(delivered.some((d: any) => d.client === 'acme' && d.type === 'status-update \u00b7 in-progress'));
  assert.ok(delivered.some((d: any) => d.client === 'globex' && d.type === 'end-of-call-report'));
  assert.ok(delivered.some((d: any) => d.status_code === 503), 'failed attempts are recorded with their status');
  const outbound = await (await fetch(`${base}/api/outbound`)).json();
  assert.deepEqual([...new Set(outbound.map((o: any) => o.client))].sort(), ['acme', 'globex']);
  assert.ok(outbound.every((o: any) => o.ok === true));

  // 8. what the page needs for the roles and the "While you wait" panel
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(state.map((c: any) => [c.slug, c.agent_role, c.caller_name]), [['acme', 'Phone receptionist', 'Priya Shah'], ['globex', 'Phone dispatcher', 'Maria Lopez']]);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).lookup_delay_ms, 50);

  // 9. malformed bodies get a 400 and a log entry, never a crash or a stack trace
  const raw_post = signed_post;
  const bad_args = tool_calls('asst-acme', 'x');
  (bad_args.toolCallList[0].function as any).arguments = '{bad';
  const bad_res = await post('/clients/acme/webhook', bad_args);
  assert.equal(bad_res.status, 400);
  assert.equal(logs.acme[0].type, 'bad-request');
  const not_array = await post('/clients/acme/webhook', { ...tool_calls('asst-acme', 'x'), toolCallList: 'nope' });
  assert.equal(not_array.status, 400);
  const broken = await raw_post('/clients/acme/webhook', '{"message":');
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: 'bad request' });
  const huge = await raw_post('/clients/acme/webhook', JSON.stringify({ message: { type: 'status-update', pad: 'x'.repeat(3 * 1024 * 1024) } }));
  assert.equal(huge.status, 413);
  assert.deepEqual(await huge.json(), { error: 'body too large' });
  await sleep(100);
  assert.equal(control_requests.length, 2, 'bad requests start no lookups');

  // 10. a controlUrl that is not a Vapi host is never called
  const outside = tool_calls('asst-acme', 'Priya Shah');
  outside.call.monitor.controlUrl = 'https://control.example.com/hook';
  outside.toolCallList[0].id = 'tc-outside';
  assert.equal((await post('/clients/acme/webhook', outside)).status, 200);
  assert.equal(logs.acme[0].type, 'lookup-error');
  assert.match(logs.acme[0].detail, /not an https \*\.vapi\.ai URL/);
  assert.doesNotThrow(() => assertControlUrl('https://phone-call-websocket.aws-us-west-2-backend-production2.vapi.ai/abc/control'));
  for (const url of ['http://x.vapi.ai/c', 'https://vapi.ai.evil.com/c', 'https://evil.com/.vapi.ai', 'https://user:pw@x.vapi.ai/c', 'not a url', 'http://localhost:4000/c']) {
    if (url === 'http://localhost:4000/c') { process.env.ALLOW_LOCAL_CONTROL_URL = 'false'; }
    assert.throws(() => assertControlUrl(url), /controlUrl/, url);
  }
  process.env.ALLOW_LOCAL_CONTROL_URL = 'true';

  // 11. if posting to the controlUrl fails, a redelivery of the same tool call retries it
  const flaky = tool_calls('asst-acme', 'Priya Shah');
  flaky.call.monitor.controlUrl = `http://localhost:${control_port}/flaky/control`;
  flaky.toolCallList[0].id = 'tc-flaky';
  await post('/clients/acme/webhook', flaky);
  await sleep(300);
  assert.equal(logs.acme[0].type, 'lookup-error');
  await post('/clients/acme/webhook', flaky);
  await sleep(300);
  assert.equal(control_requests.filter((r) => r.url?.startsWith('/flaky')).length, 2);
  assert.equal(logs.acme[0].type, 'live-call-control');

  console.log('All checks passed');
  app.close(); control.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
