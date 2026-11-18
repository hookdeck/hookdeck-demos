import { planRetry } from './retry';
import { Lead, LeadStatus, addTimeline, findLeadByCall, getLead, updateLead } from './store';

export interface RetellWebhook {
  event: string;
  call: {
    call_id: string;
    call_status?: string;
    metadata?: { lead_id?: string };
    start_timestamp?: number;
    end_timestamp?: number;
    disconnection_reason?: string;
    transcript?: string;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
      call_successful?: boolean;
      in_voicemail?: boolean;
      custom_analysis_data?: Record<string, unknown>;
    };
  };
}

export interface DeliveryMeta {
  hookdeck_event_id?: string;
}

// Calls that never connected still get call_ended and call_analyzed (but no call_started).
// These are the `not_connected` rows of Retell's disconnection reasons table
// (https://docs.retellai.com/reliability/debug-call-disconnect, checked 2026-11-18), plus
// voicemail_reached, which Retell lists as an `ended` call but which means the lead did not pick up.
const NOT_CONNECTED = new Set([
  'dial_failed', 'dial_no_answer', 'dial_busy', 'invalid_destination', 'user_declined',
  'telephony_provider_permission_denied', 'telephony_provider_unavailable', 'sip_routing_error', 'marked_as_spam', 'network_blocked',
  'voicemail_reached',
]);

// call_started -> call_ended -> call_analyzed normally, but the app doesn't rely on the order
export const RANK: Record<LeadStatus, number> = { new: 0, calling: 1, in_call: 2, completed: 3, no_answer: 3, failed: 3, analyzed: 4 };

export function advance(lead: Lead, status: LeadStatus): LeadStatus {
  return RANK[status] >= RANK[lead.status] ? status : lead.status;
}

const ACCOUNT_ERRORS = new Set(['concurrency_limit_reached', 'no_valid_payment', 'credit_exhausted', 'budget_reached', 'scam_detected', 'registered_call_timeout']);

export function endStatus(disconnection_reason: string | undefined): LeadStatus {
  if (!disconnection_reason) return 'completed';
  if (disconnection_reason === 'dial_no_answer' || disconnection_reason === 'dial_busy' || disconnection_reason === 'voicemail_reached') {
    return 'no_answer';
  }
  // Account and abuse conditions (status `error` in Retell's table) never reached the lead either
  if (NOT_CONNECTED.has(disconnection_reason) || ACCOUNT_ERRORS.has(disconnection_reason) || disconnection_reason.startsWith('error_')) return 'failed';
  return 'completed';
}

export type ApplyResult = 'applied' | 'duplicate' | 'unknown_lead' | 'stale' | 'invalid';

/**
 * Applies one Retell call event to the lead it belongs to.
 *
 * Idempotent on (event, call_id): Hookdeck's deduplicate rule normally drops repeats
 * before they get here, and a replay from the dashboard or a retry after a failed
 * attempt can still deliver the same event twice, so the app keeps its own record.
 *
 * Returns 'invalid' for a body that is not a Retell call event, and 'stale' for an event
 * about an earlier attempt's call than the one the lead is on.
 */
export function applyRetellEvent(payload: RetellWebhook, meta: DeliveryMeta = {}): ApplyResult {
  if (!payload || typeof payload.event !== 'string') return 'invalid';
  const { event, call } = payload;
  if (!call || typeof call.call_id !== 'string' || !call.call_id) return 'invalid';
  const lead_id = call.metadata?.lead_id;
  const lead = (typeof lead_id === 'string' && getLead(lead_id)) || findLeadByCall(call.call_id);
  if (!lead) return 'unknown_lead';

  // A lead has one call per attempt, so a repeat is the same event for the same call
  if (lead.timeline.some(t => t.event === event && t.call_id === call.call_id && !t.note)) {
    addTimeline(lead.id, { event, call_id: call.call_id, hookdeck_event_id: meta.hookdeck_event_id, note: 'duplicate, ignored' });
    return 'duplicate';
  }

  // A late event for an earlier attempt's call must not change the attempt the lead is on.
  // A lead with no current call id (a retry whose browser call has not reported yet) accepts any call
  // that is not one of its earlier attempts.
  if ((lead.call_id && lead.call_id !== call.call_id) || lead.past_call_ids?.includes(call.call_id)) {
    addTimeline(lead.id, { event, call_id: call.call_id, hookdeck_event_id: meta.hookdeck_event_id, note: 'stale call, ignored' });
    return 'stale';
  }

  switch (event) {
    case 'call_started':
      updateLead(lead.id, { call_id: call.call_id, status: advance(lead, 'in_call'), retry_backup: undefined });
      break;
    case 'call_ended':
      updateLead(lead.id, {
        call_id: call.call_id,
        status: advance(lead, endStatus(call.disconnection_reason)),
        disconnection_reason: call.disconnection_reason,
        duration_seconds:
          call.start_timestamp && call.end_timestamp ? Math.round((call.end_timestamp - call.start_timestamp) / 1000) : undefined,
        retry_backup: undefined,
        ...planRetry(lead.attempt, call.disconnection_reason),
      });
      break;
    case 'call_analyzed': {
      const analysis = call.call_analysis;
      updateLead(lead.id, {
        call_id: call.call_id,
        status: advance(lead, 'analyzed'),
        summary: analysis?.call_summary,
        sentiment: analysis?.user_sentiment,
        call_successful: analysis?.call_successful,
        analysis: analysis?.custom_analysis_data,
      });
      break;
    }
    default:
      break;
  }
  // Recorded last: if an update above throws, the redelivery is not mistaken for a duplicate
  addTimeline(lead.id, { event, call_id: call.call_id, hookdeck_event_id: meta.hookdeck_event_id });
  return 'applied';
}

export type { LeadStatus };
