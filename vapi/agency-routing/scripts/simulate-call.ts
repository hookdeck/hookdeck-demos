/**
 * Replays one call's webhooks through a client's Hookdeck source, signed with the demo's secret,
 * so you can watch the flow (and the data-flow drawer) without a microphone. A local stand-in
 * for Vapi's controlUrl receives the app's async-tool result.
 *
 * Sends: status-update (in-progress), tool-calls (lookup_customer), a badly signed copy of the
 * status-update (rejected with 401), status-update (ended), end-of-call-report.
 *
 * Usage: npm run simulate [-- acme|globex]
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import * as http from 'http';
import { CLIENTS, clientBySlug } from '../src/clients';

const client = clientBySlug(process.argv[2] || 'acme') || CLIENTS[0];
const secret = process.env.VAPI_WEBHOOK_SECRET!;
const url = process.env[client.env_source_url]!;
const assistant_id = process.env[client.env_assistant_id]!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sign = (body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function send(label: string, message: object, signature_ok = true) {
  const body = JSON.stringify({ message });
  const res = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': sign(signature_ok ? body : body + 'x') } });
  console.log(`${label.padEnd(34)} -> ${res.status}`);
}

async function main() {
  // Stand-in for Vapi's monitor.controlUrl
  const stub = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'));
  });
  await new Promise<void>((resolve) => stub.listen(0, resolve));
  const control_url = `http://localhost:${(stub.address() as any).port}/control`;

  const call = { id: `sim-${crypto.randomBytes(8).toString('hex')}`, assistantId: assistant_id, monitor: { controlUrl: control_url } };
  const customer = client.crm[0].name;
  await send('status-update in-progress', { type: 'status-update', status: 'in-progress', call });
  await sleep(1500);
  await send('tool-calls lookup_customer', {
    type: 'tool-calls', call,
    toolCallList: [{ id: `call_${crypto.randomBytes(6).toString('hex')}`, type: 'function', function: { name: 'lookup_customer', arguments: { customer_name: customer } } }],
  });
  await sleep(1000);
  await send('status-update (bad signature)', { type: 'status-update', status: 'in-progress', call }, false);
  const wait = Number(process.env.LOOKUP_DELAY_MS || 6000) + 1500;
  console.log(`waiting ${wait} ms for the app's result to go to the controlUrl stand-in...`);
  await sleep(wait);
  await send('status-update ended', { type: 'status-update', status: 'ended', endedReason: 'customer-ended-call', call });
  await sleep(1000);
  await send('end-of-call-report', { type: 'end-of-call-report', endedReason: 'customer-ended-call', call, artifact: { messages: [] } });
  stub.close();
}
main().catch((error) => { console.error(error.message); process.exit(1); });
