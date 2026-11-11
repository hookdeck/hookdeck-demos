/**
 * Sends signed and badly signed requests to each client's Hookdeck source, in the signature
 * formats Vapi can produce, and prints how Hookdeck responded. Not part of the demo flow.
 * Usage: npx ts-node scripts/probe.ts
 */
import 'dotenv/config';
import * as crypto from 'crypto';

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

(async () => {
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
})();
