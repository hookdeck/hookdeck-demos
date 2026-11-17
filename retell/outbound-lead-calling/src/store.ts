import * as fs from 'fs';
import * as path from 'path';

export type LeadStatus = 'new' | 'calling' | 'in_call' | 'completed' | 'no_answer' | 'failed' | 'analyzed';

export interface TimelineEntry {
  at: string;
  event: string;
  /** Hookdeck event ID (x-hookdeck-eventid), when the delivery came through Hookdeck */
  hookdeck_event_id?: string;
  /** The call the event belongs to: a lead has one call per attempt */
  call_id?: string;
  /** "duplicate" when the app had already processed this event for this call */
  note?: string;
}

export interface Lead {
  id: string;
  name: string;
  property_interest: string;
  notes: string;
  /** Masked: the real number never leaves .env */
  phone_masked: string;
  status: LeadStatus;
  created_at: string;
  call_id?: string;
  disconnection_reason?: string;
  duration_seconds?: number;
  summary?: string;
  sentiment?: string;
  call_successful?: boolean;
  analysis?: Record<string, unknown>;
  error?: string;
  /** Retry ladder (src/retry.ts): the attempt being waited for or in progress, starting at 1 */
  attempt?: number;
  /** When the next attempt is due, while the app is waiting to ring the lead again */
  next_attempt_at?: string;
  gave_up?: boolean;
  /** Made by the page without a Retell call; its events come from `npm run simulate` or the page's "Lead does not answer" */
  simulated?: boolean;
  timeline: TimelineEntry[];
}

const FILE = process.env.LEADS_FILE || path.join(__dirname, '..', 'data', 'leads.json');

let leads: Lead[] = [];
try {
  leads = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
} catch {
  leads = [];
}

function persist(): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(leads, null, 2));
}

export const listLeads = (): Lead[] => [...leads].reverse();
export const getLead = (id: string): Lead | undefined => leads.find(l => l.id === id);
export const findLeadByCall = (call_id: string): Lead | undefined => leads.find(l => l.call_id === call_id);

export function addLead(lead: Lead): void {
  leads.push(lead);
  persist();
}

export function updateLead(id: string, patch: Partial<Lead>): Lead | undefined {
  const lead = getLead(id);
  if (!lead) return undefined;
  Object.assign(lead, patch);
  persist();
  return lead;
}

export function addTimeline(id: string, entry: Omit<TimelineEntry, 'at'>): void {
  const lead = getLead(id);
  if (!lead) return;
  lead.timeline.push({ at: new Date().toISOString(), ...entry });
  persist();
}
