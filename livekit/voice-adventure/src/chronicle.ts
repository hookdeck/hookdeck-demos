/**
 * The session chronicle: a story-style timeline of one room, built only from the webhooks the app
 * receives through Event Gateway. Like the call log it is order-independent and idempotent on the
 * event id, so a duplicate or a late delivery leaves it the same.
 *
 * Who is who comes from the payload. `participant.kind` is `AGENT` for the intro agent and the game
 * master (one agent participant, handed off between roles; its `lk.agent.name` attribute names the
 * agent), `INGRESS` for a soundtrack the app pulls in with the Ingress API, and absent (the default,
 * STANDARD) for a player. Track events don't carry `kind`, so the chronicle uses participant events.
 */
import { LiveKitEvent, toMs } from './call-log';

export type Role = 'player' | 'gm' | 'soundtrack' | 'other';

export interface Person {
  identity: string;
  role: Role;
  name?: string;
  joined_at?: number;
  left_at?: number;
  dropped?: boolean;
  disconnect_reason?: string;
}

export interface Scene {
  ingress_id: string;
  /** The scene name the app gave the ingress (`scene:tavern`). */
  title: string;
  started_at?: number;
  ended_at?: number;
}

export interface ChronicleSession {
  key: string;
  room_name: string;
  started_at?: number;
  ended_at?: number;
  last_event_at: number;
  people: Record<string, Person>;
  scenes: Record<string, Scene>;
  event_ids: string[];
}

export interface Chronicle {
  sessions: Record<string, ChronicleSession>;
}

export const emptyChronicle = (): Chronicle => ({ sessions: {} });

const min = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const max = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

const DROP_REASONS = new Set(['CONNECTION_TIMEOUT', 'JOIN_FAILURE']);

export function roleOf(p: { kind?: string; identity?: string; attributes?: Record<string, string> }): Role {
  switch (p.kind) {
    case 'AGENT': return 'gm';
    case 'INGRESS': return 'soundtrack';
    case 'EGRESS': case 'SIP': case 'CONNECTOR': return 'other';
  }
  if (p.identity?.startsWith('soundtrack-')) return 'soundtrack';
  return 'player';
}

const sceneTitle = (name?: string) => {
  const s = (name || '').replace(/^scene:/, '');
  return s ? s[0].toUpperCase() + s.slice(1) : 'Scene';
};

/**
 * The session an event belongs to. The room sid comes first: two sessions can reuse a room name (a room that finished and was
 * opened again), and the name alone would merge them. Only an event with no sid (an ingress_started carries none) is matched by
 * name, to the newest session of that name that has not finished. A session known only by name moves under its sid when a sid appears.
 */
function findSession(chronicle: Chronicle, room_name: string, sid: string | undefined): ChronicleSession {
  const named = Object.values(chronicle.sessions).filter((s) => s.room_name === room_name);
  if (sid) {
    if (chronicle.sessions[sid]) return chronicle.sessions[sid];
    const placeholder = named.find((s) => s.key.startsWith('name:'));
    if (placeholder) {
      delete chronicle.sessions[placeholder.key];
      placeholder.key = sid;
      return (chronicle.sessions[sid] = placeholder);
    }
    return (chronicle.sessions[sid] = { key: sid, room_name, last_event_at: 0, people: {}, scenes: {}, event_ids: [] });
  }
  const newest = (list: ChronicleSession[]) => list.sort((a, b) => b.last_event_at - a.last_event_at)[0];
  const found = newest(named.filter((s) => !s.ended_at)) || newest(named);
  if (found) return found;
  const key = `name:${room_name}`;
  return (chronicle.sessions[key] = { key, room_name, last_event_at: 0, people: {}, scenes: {}, event_ids: [] });
}

export function applyChronicle(chronicle: Chronicle, event: LiveKitEvent): { duplicate: boolean } {
  const info = (event as any).ingressInfo;
  const room_name = event.room?.name || info?.roomName;
  if (!room_name) return { duplicate: false };
  // Ingress events carry the room's sid in `state.roomId` (only the ended one, in practice) and its name in `roomName`
  const sid: string | undefined = event.room?.sid || info?.state?.roomId;
  const session = findSession(chronicle, room_name, sid);
  if (session.event_ids.includes(event.id)) return { duplicate: true };

  const at = toMs(event.createdAt) ?? Date.now();
  session.last_event_at = Math.max(session.last_event_at, at);

  switch (event.event) {
    case 'room_started':
      session.started_at = min(session.started_at, toMs(event.room?.creationTimeMs) ?? toMs(event.room?.creationTime) ?? at);
      break;
    case 'room_finished':
      session.ended_at = max(session.ended_at, at);
      break;
    case 'participant_joined':
    case 'participant_left':
    case 'participant_connection_aborted': {
      const p = event.participant as any;
      if (!p?.identity) break;
      const person = (session.people[p.identity] ||= { identity: p.identity, role: roleOf(p) });
      if (p.kind) person.role = roleOf(p);
      person.name = p.name || person.name;
      if (event.event === 'participant_joined') person.joined_at = min(person.joined_at, toMs(p.joinedAtMs) ?? toMs(p.joinedAt) ?? at);
      else {
        person.left_at = max(person.left_at, at);
        person.joined_at = min(person.joined_at, toMs(p.joinedAtMs) ?? toMs(p.joinedAt));
        person.disconnect_reason = p.disconnectReason || person.disconnect_reason;
        if (event.event === 'participant_connection_aborted' || DROP_REASONS.has(p.disconnectReason)) person.dropped = true;
      }
      break;
    }
    case 'ingress_started':
    case 'ingress_ended': {
      const info = (event as any).ingressInfo;
      if (!info?.ingressId) break;
      const scene = (session.scenes[info.ingressId] ||= { ingress_id: info.ingressId, title: sceneTitle(info.name) });
      if (event.event === 'ingress_started') scene.started_at = min(scene.started_at, toMs(info.state?.startedAt) ?? at);
      else scene.ended_at = max(scene.ended_at, toMs(info.state?.endedAt) ?? at);
      break;
    }
    default:
      break;
  }
  // Seen only now that it is applied: if applying threw, the retry must not count as a duplicate
  session.event_ids.push(event.id);
  return { duplicate: false };
}

export interface ChronicleLine {
  at: number;
  kind: 'room' | 'player' | 'gm' | 'scene' | 'drop' | 'end';
  text: string;
}

export interface ChronicleView {
  key: string;
  room_name: string;
  status: 'in progress' | 'ended';
  length_s?: number;
  players: string[];
  scenes: number;
  lines: ChronicleLine[];
}

const label = (p: Person) => {
  if (p.name && p.name !== p.identity) return p.name;
  // A silent bot player from the page's "Add a bot player" button: bot-pixel
  return p.identity.startsWith('bot-') ? `${p.identity.slice(4, 5).toUpperCase()}${p.identity.slice(5)} (bot)` : p.identity;
};
const seconds = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.max(0, Math.round((b - a) / 1000)) : undefined);

export function viewChronicle(chronicle: Chronicle): ChronicleView[] {
  return Object.values(chronicle.sessions)
    .map((s): ChronicleView => {
      const lines: ChronicleLine[] = [];
      if (s.started_at) lines.push({ at: s.started_at, kind: 'room', text: 'The room opened' });
      // A second agent joining the same room means the storyteller came back (LiveKit re-dispatched it, or "Continue the story")
      const gm_order = Object.values(s.people).filter((p) => p.role === 'gm').sort((a, b) => (a.joined_at ?? 0) - (b.joined_at ?? 0)).map((p) => p.identity);
      for (const p of Object.values(s.people)) {
        if (p.role === 'soundtrack' || p.role === 'other') continue;
        const returned = p.role === 'gm' && gm_order.indexOf(p.identity) > 0;
        const who = p.role === 'gm' ? (returned ? 'The storyteller' : 'The story agent') : label(p);
        const kind = p.role === 'gm' ? 'gm' : 'player';
        if (p.joined_at) lines.push({ at: p.joined_at, kind, text: returned ? 'The storyteller returned' : `${who} joined` });
        if (p.left_at) lines.push(p.dropped
          ? { at: p.left_at, kind: 'drop', text: `${who} dropped (connection ${p.disconnect_reason === 'CONNECTION_TIMEOUT' ? 'timed out' : 'aborted'})` }
          : { at: p.left_at, kind, text: `${who} left` });
      }
      const scenes = Object.values(s.scenes).sort((a, b) => (a.started_at ?? a.ended_at ?? 0) - (b.started_at ?? b.ended_at ?? 0));
      scenes.forEach((sc, i) => {
        if (sc.started_at) lines.push({ at: sc.started_at, kind: 'scene', text: `Scene ${i + 1}, ${sc.title}: soundtrack started` });
        if (sc.ended_at) {
          const len = seconds(sc.started_at, sc.ended_at);
          lines.push({ at: sc.ended_at, kind: 'scene', text: `Scene ${i + 1}, ${sc.title}: soundtrack ended${len !== undefined ? ` after ${len} s` : ''}` });
        }
      });
      const length_s = seconds(s.started_at, s.ended_at);
      if (s.ended_at) lines.push({ at: s.ended_at, kind: 'end', text: `The session ended${length_s !== undefined ? `, ${length_s >= 60 ? `${Math.floor(length_s / 60)} min ` : ''}${length_s % 60} s long` : ''}` });
      lines.sort((a, b) => a.at - b.at);
      return {
        key: s.key,
        room_name: s.room_name,
        status: s.ended_at ? 'ended' : 'in progress',
        length_s,
        players: Object.values(s.people).filter((p) => p.role === 'player').map(label),
        scenes: scenes.length,
        lines,
      };
    })
    .filter((v) => v.lines.length > 0)
    .sort((a, b) => (b.lines[0]?.at ?? 0) - (a.lines[0]?.at ?? 0));
}
