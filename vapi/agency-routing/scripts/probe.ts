/**
 * Proves signature verification is on for each client's Hookdeck source: a correctly signed
 * request must be accepted (200, request verified) and a badly signed one rejected (401, request
 * recorded with rejection_cause VERIFICATION_FAILED and no event). The request records come from
 * the Hookdeck API, so the check does not rely on the HTTP status alone.
 *
 * With --variants it also sends the other signature formats Vapi can produce and prints the HTTP
 * status for each. Not part of the demo flow.
 *
 * Usage: npm run probe [-- --variants]
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { createHookdeckCli } from './hookdeck-cli';

const secret = process.env.VAPI_WEBHOOK_SECRET!;
const targets = [
  { name: 'Acme', url: process.env.ACME_SOURCE_URL!, assistant: process.env.ACME_ASSISTANT_ID! },
  { name: 'Globex', url: process.env.GLOBEX_SOURCE_URL!, assistant: process.env.GLOBEX_ASSISTANT_ID! },
];
const hex = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('hex');
const b64 = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64');

async function send(label: string, url: string, body: string, headers: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
  console.log(`${label.padEnd(44)} -> ${res.status} ${(await res.text()).slice(0, 90)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The request record whose body carries `call_id`, read back from the Hookdeck API. */
async function findRequest(cli: ReturnType<typeof createHookdeckCli>, source_id: string, call_id: string): Promise<any> {
  const list = await cli.api('GET', `/requests?source_id=${source_id}&limit=20`);
  for (const summary of list.models) {
    const detail = await cli.api('GET', `/requests/${summary.id}`);
    if (detail.data?.body?.message?.call?.id === call_id) return detail;
  }
  return undefined;
}

async function prove(): Promise<boolean> {
  const cli = createHookdeckCli();
  let all_ok = true;
  for (const t of targets) {
    const source = (await cli.api('GET', `/sources?name=${encodeURIComponent(t.name === 'Acme' ? 'vapi-acme-dental' : 'vapi-globex-plumbing')}`)).models[0];
    const results: Array<[string, boolean, string]> = [];
    for (const [label, good] of [['correctly signed', true], ['badly signed', false]] as const) {
      const call_id = `probe-${label.split(' ')[0]}-${crypto.randomBytes(4).toString('hex')}`;
      const body = JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call: { id: call_id, assistantId: t.assistant } } });
      const res = await fetch(t.url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': hex(good ? body : body + 'x') } });
      let record: any;
      for (let i = 0; i < 8 && !record; i++) {
        await sleep(1500);
        record = await findRequest(cli, source.id, call_id);
      }
      const ok = good
        ? res.status === 200 && record?.verified === true
        : res.status === 401 && record?.verified === false && record?.rejection_cause === 'VERIFICATION_FAILED';
      results.push([label, ok, `HTTP ${res.status}, verified=${record?.verified}, rejection_cause=${record?.rejection_cause ?? 'none'}`]);
      all_ok = all_ok && ok;
    }
    console.log(`${t.name}`);
    for (const [label, ok, detail] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(17)} ${detail}`);
  }
  console.log(all_ok ? '\nVerification is ON for both sources.' : '\nVerification check FAILED.');
  return all_ok;
}

async function variants() {
  for (const t of targets) {
    const body = JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call: { id: `probe-${Date.now()}`, assistantId: t.assistant } } });
    const ts = String(Math.floor(Date.now() / 1000));
    console.log(`\n${t.name}`);
    await send('bare hex of body', t.url, body, { 'x-signature': hex(body) });
    await send('bad signature', t.url, body, { 'x-signature': hex(body + 'x') });
    await send('no signature', t.url, body, {});
    await send('sha256=<hex> prefix', t.url, body, { 'x-signature': 'sha256=' + hex(body) });
    await send('Vapi default {timestamp}.{body} (hex)', t.url, body, { 'x-signature': hex(`${ts}.${body}`), 'x-timestamp': ts });
    await send('Vapi default, t=..,v1=.. style', t.url, body, { 'x-signature': `t=${ts},v1=${hex(`${ts}.${body}`)}` });
    await send('base64 of body', t.url, body, { 'x-signature': b64(body) });
  }
}

(async () => {
  const ok = await prove();
  if (process.argv.includes('--variants')) await variants();
  process.exit(ok ? 0 : 1);
})();
