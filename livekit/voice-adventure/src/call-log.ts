/**
 * Builds a call log from LiveKit webhook events.
 *
 * Every event is applied as an idempotent "set this field" update, keyed by the
 * room's session id (room.sid), so the log comes out the same however the events
 * arrive: duplicated (a retry), or out of order (participant_joined before room_started).
 */

export interface LiveKitEvent {
  id: string;
  createdAt: number | string;
  event: string;
  room?: { sid?: string; name?: string; creationTime?: number | string; creationTimeMs?: number | string };
  participant?: { sid?: string; identity?: string; name?: string; kind?: string; joinedAt?: number | string; joinedAtMs?: number | string; disconnectReason?: string };
  egressInfo?: EgressInfo;
  [key: string]: unknown;
}

interface EgressFileResult {
  filename?: string;
  location?: string;
  size?: number | string;
  duration?: number | string;
  startedAt?: number | string;
  endedAt?: number | string;
}

interface EgressInfo {
  egressId?: string;
  roomId?: string;
  roomName?: string;
  status?: string;
  startedAt?: number | string;
  endedAt?: number | string;
  error?: string;
  fileResults?: EgressFileResult[];
  segmentResults?: { playlistName?: string; playlistLocation?: string; size?: number | string; duration?: number | string }[];
  file?: EgressFileResult;
}

export interface ParticipantEntry {
  identity: string;
  name?: string;
  joined_at?: number; // ms
  left_at?: number; // ms
  disconnect_reason?: string;
  /** AGENT for the story agent, INGRESS for a soundtrack; absent for a player */
  kind?: string;
}

export interface RecordingLink {
  label: string;
  url: string;
  size?: number;
  duration_s?: number;
}

export interface RecordingEntry {
  egress_id: string;
  status?: string;
  started_at?: number; // ms
  ended_at?: number; // ms
  error?: string;
  links: RecordingLink[];
}

export interface CallSession {
  key: string; // room.sid, or the room name until a sid is seen
  room_sid?: string;
  room_name: string;
  started_at?: number; // ms
  ended_at?: number; // ms
  participants: Record<string, ParticipantEntry>;
  recordings: Record<string, RecordingEntry>;
  event_ids: string[];
  last_event_at: number; // ms
}

export interface CallLog {
  sessions: Record<string, CallSession>;
}

export const emptyLog = (): CallLog => ({ sessions: {} });

/**
 * Normalises a Unix timestamp to milliseconds. LiveKit uses seconds in the
 * event envelope and room.creationTime, and nanoseconds in egressInfo.
 */
export function toMs(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 1e11) return n * 1000; // seconds
  if (n < 1e14) return n; // milliseconds
  if (n < 1e17) return n / 1000; // microseconds
  return Math.round(n / 1e6); // nanoseconds
}

const min = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const max = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/** Finds the session for an event, merging a name-keyed placeholder into the sid-keyed one. */
function sessionFor(log: CallLog, room: LiveKitEvent['room'], fallback_name?: string, egress_room_id?: string): CallSession | undefined {
  const sid = room?.sid || egress_room_id;
  const name = room?.name || fallback_name;
  if (!sid && !name) return undefined;
  const key = sid || `name:${name}`;
  let session = log.sessions[key];
  if (!session) {
    session = { key, room_sid: sid, room_name: name || '', participants: {}, recordings: {}, event_ids: [], last_event_at: 0 };
    log.sessions[key] = session;
  }
  if (name && !session.room_name) session.room_name = name;
  return session;
}

export interface ApplyResult {
  duplicate: boolean;
  session_key?: string;
}

export function applyEvent(log: CallLog, event: LiveKitEvent): ApplyResult {
  const created_ms = toMs(event.createdAt) ?? Date.now();
  const egress = event.egressInfo;
  const session = sessionFor(log, event.room, egress?.roomName, egress?.roomId);
  if (!session) return { duplicate: false };

  if (session.event_ids.includes(event.id)) return { duplicate: true, session_key: session.key };
  session.last_event_at = Math.max(session.last_event_at, created_ms);

  const room_created = toMs(event.room?.creationTimeMs) ?? toMs(event.room?.creationTime);
  if (event.event !== 'room_finished') session.started_at = min(session.started_at, room_created);

  switch (event.event) {
    case 'room_started':
      session.started_at = min(session.started_at, room_created ?? created_ms);
      break;
    case 'room_finished':
      session.started_at = min(session.started_at, room_created);
      session.ended_at = max(session.ended_at, created_ms);
      break;
    case 'participant_joined':
    case 'participant_left':
    case 'participant_connection_aborted': {
      const p = event.participant;
      if (!p?.identity) break;
      const entry = (session.participants[p.identity] ||= { identity: p.identity });
      entry.name = p.name || entry.name;
      entry.kind = p.kind || entry.kind;
      if (event.event === 'participant_joined') {
        entry.joined_at = min(entry.joined_at, toMs(p.joinedAtMs) ?? toMs(p.joinedAt) ?? created_ms);
      } else {
        entry.left_at = max(entry.left_at, created_ms);
        entry.joined_at = min(entry.joined_at, toMs(p.joinedAtMs) ?? toMs(p.joinedAt));
        entry.disconnect_reason = p.disconnectReason || (event.event === 'participant_connection_aborted' ? 'CONNECTION_ABORTED' : entry.disconnect_reason);
      }
      break;
    }
    case 'egress_started':
    case 'egress_updated':
    case 'egress_ended': {
      if (!egress?.egressId) break;
      const rec = (session.recordings[egress.egressId] ||= { egress_id: egress.egressId, links: [] });
      // egress_updated can arrive after egress_ended: never move a finished status backwards
      if (event.event === 'egress_ended' || !/COMPLETE|FAILED|ABORTED|LIMIT_REACHED/.test(rec.status || '')) {
        rec.status = egress.status || rec.status;
      }
      rec.started_at = min(rec.started_at, toMs(egress.startedAt));
      rec.ended_at = max(rec.ended_at, toMs(egress.endedAt));
      rec.error = egress.error || rec.error;
      const files = [...(egress.fileResults || []), ...(egress.file ? [egress.file] : [])];
      for (const f of files) {
        const url = f.location;
        if (url && !rec.links.some((l) => l.url === url)) {
          rec.links.push({ label: f.filename || url.split('/').pop() || 'recording', url, size: f.size ? Number(f.size) : undefined, duration_s: f.duration ? Math.round(Number(f.duration) / 1e9) : undefined });
        }
      }
      for (const s of egress.segmentResults || []) {
        const url = s.playlistLocation;
        if (url && !rec.links.some((l) => l.url === url)) rec.links.push({ label: s.playlistName || 'playlist', url });
      }
      break;
    }
    default:
      break; // track_*, ingress_*: recorded in the delivery list only
  }

  // Seen only now that it is applied: if applying threw, the retry must not count as a duplicate
  session.event_ids.push(event.id);

  // A name-keyed placeholder created before any sid was seen moves under the sid
  if (session.room_sid && log.sessions[`name:${session.room_name}`] && session.key !== `name:${session.room_name}`) {
    mergeInto(session, log.sessions[`name:${session.room_name}`]);
    delete log.sessions[`name:${session.room_name}`];
  }
  return { duplicate: false, session_key: session.key };
}

function mergeInto(target: CallSession, source: CallSession): void {
  for (const id of source.event_ids) if (!target.event_ids.includes(id)) target.event_ids.push(id);
  target.started_at = min(target.started_at, source.started_at);
  target.ended_at = max(target.ended_at, source.ended_at);
  target.last_event_at = Math.max(target.last_event_at, source.last_event_at);
  Object.assign(target.participants, { ...source.participants, ...target.participants });
  Object.assign(target.recordings, { ...source.recordings, ...target.recordings });
}

export type CallStatus = 'in progress' | 'ended';

export interface CallSummary extends CallSession {
  status: CallStatus;
  duration_s?: number;
}

export function summarise(log: CallLog): CallSummary[] {
  return Object.values(log.sessions)
    .map((s) => ({
      ...s,
      status: (s.ended_at ? 'ended' : 'in progress') as CallStatus,
      duration_s: s.started_at && s.ended_at ? Math.max(0, Math.round((s.ended_at - s.started_at) / 1000)) : undefined,
    }))
    .sort((a, b) => (b.started_at ?? b.last_event_at) - (a.started_at ?? a.last_event_at));
}
