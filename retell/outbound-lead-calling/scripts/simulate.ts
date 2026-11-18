/**
 * Sends correctly signed Retell events to your Hookdeck source, without placing a call.
 * The signature uses RETELL_SECRET_KEY (or RETELL_API_KEY when that is the webhook-badged key), the same key Hookdeck verifies with.
 *
 * Usage:
 *   npm run simulate                      # call_started, call_ended, call_analyzed for the latest lead
 *   npm run simulate -- call_ended        # one event
 *   npm run simulate -- call_ended --twice  # the same event twice (the second is deduplicated)
 *   npm run simulate -- call_ended --bad-signature  # rejected by Hookdeck's verification
 *   npm run simulate -- --no-answer       # a new simulated lead that does not pick up: call_ended (dial_no_answer) starts its retry ladder
 *
 * With no lead yet, it asks the running app for a demo lead (no call is placed).
 */
import 'dotenv/config';
import { postSigned, simulatedCallId, simulatedPayload, SimulatedEvent } from '../src/simulated';

const PORT = process.env.PORT || '4000';
const URL_ = process.env.RETELL_EVENTS_URL;
// Retell signs with the API key that carries the webhook badge; the Hookdeck source verifies with it
const KEY = process.env.RETELL_SECRET_KEY || process.env.RETELL_API_KEY;

if (!URL_ || !KEY) {
  console.error('❌ RETELL_EVENTS_URL and RETELL_SECRET_KEY (or RETELL_API_KEY) must be set in .env (run npm run setup).');
  process.exit(1);
}

const args = process.argv.slice(2);
const names = args.filter(a => !a.startsWith('--'));
const no_answer = args.includes('--no-answer');
// A lead that does not pick up gets call_ended only (the retry ladder reads it); the analysis is skipped
const events = names.length ? names : no_answer ? ['call_ended'] : ['call_started', 'call_ended', 'call_analyzed'];
const twice = args.includes('--twice');
const bad_signature = args.includes('--bad-signature');

async function app(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`http://localhost:${PORT}${path}`, init);
  return response.json();
}

async function main() {
  let leads = await app('/api/leads');
  // A no-answer needs a call that hasn't ended yet. Reusing the latest lead's call would send a call_ended
  // that Event Gateway and the app already have, and it would be dropped as a duplicate.
  if (!leads.length || no_answer) {
    const created = await app('/api/leads/demo', { method: 'POST' });
    leads = await app('/api/leads');
    if (no_answer) leads = leads.filter((l: any) => l.id === created.id);
  }
  const lead = leads[0];
  const call_id = lead.call_id || simulatedCallId(lead);

  const reason = no_answer ? 'dial_no_answer' : 'agent_hangup';

  for (const event of events) {
    if (!['call_started', 'call_ended', 'call_analyzed'].includes(event)) fail(`Unknown event ${event}`);
    const payload = simulatedPayload(event as SimulatedEvent, lead, call_id, reason);
    for (let i = 0; i < (twice ? 2 : 1); i++) {
      console.log(`${event}${i ? ' (again)' : ''} -> Hookdeck ${await postSigned(URL_!, KEY!, payload, bad_signature)}`);
    }
  }
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

main().catch(error => fail(error.message));
