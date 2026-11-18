/**
 * Signed Retell events for a lead that has no real call. Used by `npm run simulate` and by the page's
 * "Lead does not answer" control. They are POSTed to the Hookdeck source URL like Retell's own, so they
 * are verified, deduplicated and delivered through Event Gateway; only the sender is stand-in.
 */
import { signRetellBody } from './retell-signature';
import type { Lead } from './store';

/** One call per attempt: attempt 1 keeps the id the demo lead was created with. */
export const simulatedCallId = (lead: Pick<Lead, 'id' | 'attempt'>): string =>
  (lead.attempt ?? 1) > 1 ? `simulated_${lead.id}_${lead.attempt}` : `simulated_${lead.id}`;

export type SimulatedEvent = 'call_started' | 'call_ended' | 'call_analyzed';

export function simulatedPayload(event: SimulatedEvent, lead: Pick<Lead, 'id' | 'name' | 'property_interest'>, call_id: string, disconnection_reason = 'agent_hangup'): object {
  // A call nobody picked up rang for about half a minute; a conversation here lasted about a minute and a half
  const start = Date.now() - (disconnection_reason.startsWith('dial_') ? 30_000 : 95_000);
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
  const ended = { ...call, call_status: 'ended', end_timestamp: Date.now(), disconnection_reason };
  switch (event) {
    case 'call_started':
      return { event, call };
    case 'call_ended':
      return { event, call: { ...ended, transcript: disconnection_reason === 'agent_hangup' ? 'Agent: Hi, is that Demo?\nUser: Yes.' : '' } };
    case 'call_analyzed':
      return {
        event,
        call: {
          ...ended,
          call_analysis: {
            call_summary: 'Simulated call. The lead confirmed interest, mentioned a budget of 450k and asked for a viewing on Tuesday.',
            user_sentiment: 'Positive',
            call_successful: true,
            in_voicemail: false,
            custom_analysis_data: { budget: '450k', viewing_requested: true, preferred_viewing_time: 'Tuesday' },
          },
        },
      };
  }
}

/** POSTs one signed event to the Hookdeck source and returns Hookdeck's HTTP status. */
export async function postSigned(url: string, key: string, payload: object, bad_signature = false): Promise<number> {
  const body = JSON.stringify(payload);
  const signature = signRetellBody(body, bad_signature ? `${key}-wrong` : key);
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-retell-signature': signature }, body });
  return response.status;
}
