/**
 * Proves signature verification is on for the Hookdeck source: a correctly signed request must
 * be accepted (200, request verified) and a badly signed one rejected (401, request recorded
 * with rejection_cause VERIFICATION_FAILED and no event). The request records come from the
 * Hookdeck API, so the check does not rely on the HTTP status alone.
 *
 * For ELEVENLABS sources, Event Gateway answers a bad signature with HTTP 200 and records
 * the request as rejected (VERIFICATION_FAILED, no event). Observed 15 minutes
 * after source creation, so this is not config propagation.
 *
 * Usage: npm run probe
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { SOURCE_NAME, cli } from './config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const url = process.env.ELEVENLABS_WEBHOOK_URL;
  if (!secret || !url) {
    console.error('ELEVENLABS_WEBHOOK_SECRET and ELEVENLABS_WEBHOOK_URL are not set. Run npm run setup first.');
    process.exit(1);
  }
  cli.login();
  const source = (await cli.api('GET', `/sources?name=${encodeURIComponent(SOURCE_NAME)}`)).models[0];
  let all_ok = true;
  for (const good of [true, false]) {
    const conversation_id = `probe_${good ? 'good' : 'bad'}_${crypto.randomBytes(4).toString('hex')}`;
    const body = JSON.stringify({
      type: 'call_initiation_failure',
      event_timestamp: Math.floor(Date.now() / 1000),
      data: { agent_id: 'probe', conversation_id, failure_reason: 'probe', metadata: { type: 'probe' } },
    });
    const t = Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac('sha256', secret).update(`${t}.${good ? body : body + 'x'}`).digest('hex');
    const res = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'ElevenLabs-Signature': `t=${t},v0=${digest}` },
    });
    let record: any;
    for (let i = 0; i < 8 && !record; i++) {
      await sleep(1500);
      const list = await cli.api('GET', `/requests?source_id=${source.id}&limit=20`);
      for (const summary of list.models) {
        const detail = await cli.api('GET', `/requests/${summary.id}`);
        if (detail.data?.body?.data?.conversation_id === conversation_id) { record = detail; break; }
      }
    }
    const ok = good
      ? res.status === 200 && record?.verified === true
      
      // Event Gateway answers 401 or 200 here, depending on the source type; the request record proves the rejection.
      : (res.status === 401 || res.status === 200) && record?.verified === false && record?.rejection_cause === 'VERIFICATION_FAILED';
    all_ok = all_ok && ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${good ? 'correctly signed' : 'badly signed    '} HTTP ${res.status}, verified=${record?.verified}, rejection_cause=${record?.rejection_cause ?? 'none'}`);
  }
  console.log(all_ok ? '\nVerification is ON.' : '\nVerification check FAILED .');
  process.exit(all_ok ? 0 : 1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
