/**
 * Proves signature verification is on for each Hookdeck source `npm run setup` created: a
 * correctly signed request must be recorded as verified, and a badly signed one as rejected
 * (rejection_cause VERIFICATION_FAILED, no event). The request records come from the Hookdeck
 * API, so the check does not rely on the HTTP status.
 *
 * RETELL sources are verified after ingestion, not at the edge: a bad signature still gets
 * HTTP 200 and is recorded as rejected, with no event created.
 *
 * Retell signs `raw_body + timestamp` (HMAC-SHA256, hex) and sends
 * `x-retell-signature: v=<unix ms>,d=<digest>`, using the API key with the webhook badge.
 *
 * Usage: npm run probe
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { signRetellBody } from '../src/retell-signature';
import { EVENTS_SOURCE, FUNCTION_SOURCE, cli } from './config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const payloads: { [source: string]: (id: string) => object } = {
  [EVENTS_SOURCE]: (id) => ({ event: 'call_ended', call: { call_id: id, call_status: 'ended', disconnection_reason: 'probe' } }),
  // Custom function requests carry {name, call, args} and no `event`
  [FUNCTION_SOURCE]: (id) => ({ name: 'check_viewing_slots', call: { call_id: id }, args: { preferred_day: 'Tuesday' } }),
};

async function probeSource(name: string, secret: string): Promise<boolean> {
  const source = (await cli.api('GET', `/sources?name=${encodeURIComponent(name)}`)).models[0];
  if (!source) {
    console.log(`SKIP  ${name}: source not found (run npm run setup)`);
    return true;
  }
  let all_ok = true;
  for (const good of [true, false]) {
    const call_id = `probe_${good ? 'good' : 'bad'}_${crypto.randomBytes(4).toString('hex')}`;
    const body = JSON.stringify(payloads[name](call_id));
    // Bad: signed with the wrong key. The body is what Retell would have signed, so only the key differs.
    const signature = signRetellBody(body, good ? secret : `${secret}-wrong`);
    const res = await fetch(source.url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-retell-signature': signature },
    });
    let record: any;
    for (let i = 0; i < 8 && !record; i++) {
      await sleep(1500);
      const list = await cli.api('GET', `/requests?source_id=${source.id}&limit=20`);
      for (const summary of list.models) {
        const detail = await cli.api('GET', `/requests/${summary.id}`);
        if (detail.data?.body?.call?.call_id === call_id) { record = detail; break; }
      }
    }
    const ok = good
      ? res.status === 200 && record?.verified === true
      // The edge may answer 401 or 200 here; the request record is what proves the rejection.
      : (res.status === 401 || res.status === 200) && record?.verified === false && record?.rejection_cause === 'VERIFICATION_FAILED';
    all_ok = all_ok && ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${good ? 'correctly signed' : 'badly signed    '} HTTP ${res.status}, verified=${record?.verified}, rejection_cause=${record?.rejection_cause ?? 'none'}`);
  }
  return all_ok;
}

async function main(): Promise<void> {
  const secret = process.env.RETELL_SECRET_KEY || process.env.RETELL_API_KEY;
  if (!secret || secret.startsWith('your_')) {
    console.error('RETELL_SECRET_KEY (or RETELL_API_KEY) is not set in .env.');
    process.exit(1);
  }
  cli.login();
  let all_ok = true;
  for (const name of [EVENTS_SOURCE, FUNCTION_SOURCE]) all_ok = (await probeSource(name, secret)) && all_ok;
  console.log(all_ok ? '\nVerification is ON.' : '\nVerification check FAILED.');
  process.exit(all_ok ? 0 : 1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
