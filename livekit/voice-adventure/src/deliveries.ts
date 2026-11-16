/**
 * The app's own record of what it answered, for the topology pane. It is fast (the pane reads it
 * about a second after the app answers) where Hookdeck's API lists a request about 3 s after it
 * arrives and its event up to 10 s.
 *
 * `deliveries`: every webhook Event Gateway delivered to this app, with the status the app answered.
 * (The fuller record, with headers and bodies for replaying a delivery through a verifier, is
 * `data/deliveries.jsonl`, written by store.ts.)
 */
import { randomUUID } from 'crypto';
import type { AppFlowEntry } from './flow-drawer-server';

export interface DeliveryRecord {
  id: string;
  received_at: string;
  /** LiveKit event (`room_started`). */
  type: string;
  room?: string;
  bytes: number;
  status_code: number;
  /** applied, duplicate, rejected, simulated_failure */
  result: string;
  hookdeck_event_id?: string;
}

const MAX = 200;
const deliveries: DeliveryRecord[] = [];
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

export const listDeliveries = (): DeliveryRecord[] => [...deliveries];

/** Calls this app made to LiveKit's Ingress API (a scene's soundtrack), for the topology pane's outbound edge. */
export interface OutboundRecord {
  id: string;
  at: string;
  kind: 'start_ingress';
  room: string;
  scene: string;
  ok: boolean;
}
const outbound: OutboundRecord[] = [];
export function logOutbound(record: Omit<OutboundRecord, 'id' | 'at'>): void {
  outbound.push({ id: randomUUID(), at: new Date().toISOString(), ...record });
  trim(outbound);
}
export const listOutbound = (): OutboundRecord[] => [...outbound];
