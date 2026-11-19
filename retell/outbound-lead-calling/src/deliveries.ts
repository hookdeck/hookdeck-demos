/**
 * The app's own record of what it was asked to do, for the topology pane. It is fast (the pane reads
 * it about a second after the app answers) where Hookdeck's API lists a request about 3 s after it
 * arrives and its event up to 10 s.
 *
 * - `deliveries`: every webhook Event Gateway delivered to this app, with the status the app answered.
 * - `outbound`: calls this app made to Retell's API (starting a call, injecting context into a live call).
 */
import { randomUUID } from 'crypto';
import type { AppFlowEntry } from './flow-drawer-server';

export interface DeliveryRecord {
  id: string;
  received_at: string;
  /** Retell event (`call_ended`), or the custom function's name for a function request. */
  type: string;
  call_id?: string;
  bytes: number;
  status_code: number;
  /** applied, duplicate, unknown_lead, simulated_failure, acknowledged, signature_rejected */
  result: string;
  hookdeck_event_id?: string;
}

export interface OutboundRecord {
  id: string;
  at: string;
  /** start_call: the app created a call; update_live_call: the app injected a function result into a live call. */
  kind: 'start_call' | 'update_live_call';
  lead_id?: string;
  call_id?: string;
  ok: boolean;
}

const MAX = 200;
const deliveries: DeliveryRecord[] = [];
const outbound: OutboundRecord[] = [];
/** What the app answered for each delivery, joined to Hookdeck's event by id (the flow state's `app` entries). */
export const flow_entries: AppFlowEntry[] = [];

const trim = <T>(list: T[]) => { if (list.length > MAX) list.splice(0, list.length - MAX); };

export function logDelivery(record: Omit<DeliveryRecord, 'id' | 'received_at'>, source: string, started: number): void {
  const full: DeliveryRecord = { id: randomUUID(), received_at: new Date().toISOString(), ...record };
  deliveries.push(full);
  trim(deliveries);
  flow_entries.push({
    id: full.id, at: full.received_at, source, kind: 'result',
    event_id: full.hookdeck_event_id, label: `returned ${full.status_code}`, detail: full.result,
    status: full.status_code, ok: full.status_code < 400, duration_ms: Date.now() - started,
  });
  trim(flow_entries);
}

export function logOutbound(record: Omit<OutboundRecord, 'id' | 'at'>): void {
  outbound.push({ id: randomUUID(), at: new Date().toISOString(), ...record });
  trim(outbound);
}

export const listDeliveries = (): DeliveryRecord[] => [...deliveries];
export const listOutbound = (): OutboundRecord[] => [...outbound];
