import { RETELL_API_BASE, RETELL_API_KEY, RETELL_AGENT_ID, RETELL_FROM_NUMBER } from './config';

async function retell(method: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${RETELL_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    // Retell's error body doesn't echo request fields, so it's safe to surface
    throw new Error(`Retell ${method} ${path} -> ${response.status}: ${data.message || data.error_message || text}`);
  }
  return data;
}

export interface LeadCallInput {
  lead_id: string;
  to_number: string;
  lead_name: string;
  property_interest: string;
  lead_notes: string;
}

/**
 * Starts the outbound call. The dynamic variables fill {{lead_name}} etc. in the
 * agent prompt. `metadata` comes back on every webhook for the call, which is how
 * the app finds the lead again. The idempotency key stops a retried request from
 * dialing the lead twice.
 * https://docs.retellai.com/api-references/create-phone-call
 */
export async function createPhoneCall(input: LeadCallInput): Promise<{ call_id: string }> {
  return retell('POST', '/v2/create-phone-call', {
    from_number: RETELL_FROM_NUMBER,
    to_number: input.to_number,
    override_agent_id: RETELL_AGENT_ID,
    idempotency_key: `lead-${input.lead_id}`,
    retell_llm_dynamic_variables: {
      lead_name: input.lead_name,
      property_interest: input.property_interest,
      lead_notes: input.lead_notes || 'none',
    },
    metadata: { lead_id: input.lead_id },
  });
}

/**
 * Injects text into the ongoing call and makes the agent speak about it.
 * https://docs.retellai.com/api-references/update-live-call
 */
export async function updateLiveCall(call_id: string, additional_context: string): Promise<void> {
  await retell('PATCH', `/v2/update-live-call/${encodeURIComponent(call_id)}`, {
    call_control: { additional_context, trigger_response: true },
  });
}

export interface WebCallDetails {
  call_id: string;
  access_token: string;
  transport?: string;
  ice_servers?: unknown[];
  expires_at?: number;
}

/**
 * Creates a browser call. Same agent, same webhooks as the phone call: the lead id rides in
 * `metadata` and comes back on every webhook. The API key stays here; the browser only gets the
 * short-lived access token.
 * https://docs.retellai.com/api-references/create-web-call
 */
export async function createWebCall(input: Omit<LeadCallInput, 'to_number'>): Promise<WebCallDetails> {
  return retell('POST', '/v3/create-web-call', {
    agent_id: RETELL_AGENT_ID,
    retell_llm_dynamic_variables: {
      lead_name: input.lead_name,
      property_interest: input.property_interest,
      lead_notes: input.lead_notes || 'none',
    },
    metadata: { lead_id: input.lead_id },
  });
}
