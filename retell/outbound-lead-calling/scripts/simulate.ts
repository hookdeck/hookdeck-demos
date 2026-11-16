/**
 * Sends correctly signed Retell events to your Hookdeck source, without placing a call.
 * The signature uses RETELL_SECRET_KEY (or RETELL_API_KEY when that is the webhook-badged key), the same key Hookdeck verifies with.
 *
 * Usage:
 *   npm run simulate                      # call_started, call_ended, call_analyzed for the latest lead
 *   npm run simulate -- call_ended        # one event
 *   npm run simulate -- call_ended --twice  # the same event twice (the second is deduplicated)
 *   npm run simulate -- call_ended --bad-signature  # rejected by Hookdeck's verification
 *
 * With no lead yet, it asks the running app for a demo lead (no call is placed).
 */
import 'dotenv/config';
import { signRetellBody } from '../src/retell-signature';

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
const events = names.length ? names : ['call_started', 'call_ended', 'call_analyzed'];
const twice = args.includes('--twice');
const bad_signature = args.includes('--bad-signature');

async function app(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`http://localhost:${PORT}${path}`, init);
  return response.json();
}

async function main() {
  let leads = await app('/api/leads');
  if (!leads.length) {
    await app('/api/leads/demo', { method: 'POST' });
    leads = await app('/api/leads');
  }
  const lead = leads[0];
  const call_id = lead.call_id || `simulated_${lead.id}`;
  const start = Date.now() - 95_000;

  const call: any = {
    call_type: 'phone_call',
    direction: 'outbound',
    call_id,
    agent_id: process.env.RETELL_AGENT_ID || 'agent_simulated',
    call_status: 'registered',
    metadata: { lead_id: lead.id },
    retell_llm_dynamic_variables: { lead_name: lead.name, property_interest: lead.property_interest },
    start_timestamp: start,
  };
  const payloads: { [event: string]: any } = {
    call_started: { event: 'call_started', call },
    call_ended: {
      event: 'call_ended',
      call: { ...call, call_status: 'ended', end_timestamp: Date.now(), disconnection_reason: 'agent_hangup', transcript: 'Agent: Hi, is that Demo?\nUser: Yes.' },
    },
    call_analyzed: {
      event: 'call_analyzed',
      call: {
        ...call,
        call_status: 'ended',
        end_timestamp: Date.now(),
        disconnection_reason: 'agent_hangup',
        call_analysis: {
          call_summary: 'Simulated call. The lead confirmed interest, mentioned a budget of 450k and asked for a viewing on Tuesday.',
          user_sentiment: 'Positive',
          call_successful: true,
          in_voicemail: false,
          custom_analysis_data: { budget: '450k', viewing_requested: true, preferred_viewing_time: 'Tuesday' },
        },
      },
    },
  };

  for (const event of events) {
    const body = JSON.stringify(payloads[event] ?? fail(`Unknown event ${event}`));
    for (let i = 0; i < (twice ? 2 : 1); i++) {
      const signature = signRetellBody(body, bad_signature ? `${KEY}-wrong` : KEY!);
      const response = await fetch(URL_!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-retell-signature': signature },
        body,
      });
      console.log(`${event}${i ? ' (again)' : ''} -> Hookdeck ${response.status}`);
    }
  }
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

main().catch(error => fail(error.message));
