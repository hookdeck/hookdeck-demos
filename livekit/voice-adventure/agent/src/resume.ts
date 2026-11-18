/**
 * Story state kept in the LiveKit room's metadata, so a story survives its agent: when LiveKit re-dispatches a dead
 * job, or someone presses "Continue the story", the new agent reads this and picks the story up where it stopped.
 * Small JSON: where the party is, the satchel and the puzzle flags, who is in the ledger, and a few lines of running summary.
 */
import { PLACES, goalDone, itemById, placeNote, type ItemId, type PlaceId, type World } from './world.ts';

export interface SavedPlayer {
  identity: string;
  name: string;
  bot: boolean;
}

export interface StoryState {
  v: 2;
  /** Places entered so far (1 means the story has started). */
  scene_index: number;
  players: SavedPlayer[];
  /** The last few exchanges, one short line each, oldest first. */
  summary: string[];
  ended: boolean;
  /** Where the party is, what it carries, and the puzzle flags. */
  world: World;
  saved_at: number;
}

export const SUMMARY_LINES = 6;
const LINE_MAX = 160;
/** LiveKit allows far more (64 KB); this is the ceiling this demo keeps itself to. */
export const STATE_MAX_CHARS = 4000;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

/** Adds one exchange to the running summary, keeping the most recent lines. */
export function addSummaryLine(lines: readonly string[], speaker: string, text: string): string[] {
  const line = clip(text, LINE_MAX);
  if (!line) return [...lines];
  return [...lines, `${speaker}: ${line}`].slice(-SUMMARY_LINES);
}

export function buildState(input: { scene_index: number; players: readonly SavedPlayer[]; summary: readonly string[]; ended?: boolean; world: World }, now = Date.now()): StoryState {
  return {
    v: 2,
    scene_index: input.scene_index,
    players: input.players.map((p) => ({ identity: p.identity, name: p.name, bot: p.bot })),
    summary: [...input.summary],
    ended: Boolean(input.ended),
    world: { location: input.world.location, satchel: [...input.world.satchel], chest_open: input.world.chest_open, lantern_lit: input.world.lantern_lit },
    saved_at: now,
  };
}

/** JSON for the room metadata. If it would be too long, the oldest summary lines go first. */
export function encodeState(state: StoryState): string {
  let current = state;
  let json = JSON.stringify(current);
  while (json.length > STATE_MAX_CHARS && current.summary.length > 0) {
    current = { ...current, summary: current.summary.slice(1) };
    json = JSON.stringify(current);
  }
  return json;
}

/** Reads room metadata; anything that is not this demo's current state (empty, other JSON, broken JSON, the older scene-based state) gives null. */
export function decodeState(metadata: string | undefined | null): StoryState | null {
  if (!metadata) return null;
  try {
    const raw = JSON.parse(metadata);
    if (!raw || raw.v !== 2 || typeof raw.scene_index !== 'number' || !Array.isArray(raw.players) || !raw.world || !(raw.world.location in PLACES)) return null;
    return {
      v: 2,
      scene_index: Math.max(0, Math.floor(raw.scene_index)),
      players: raw.players.filter((p: any) => p && typeof p.identity === 'string' && typeof p.name === 'string').map((p: any) => ({ identity: p.identity, name: p.name, bot: Boolean(p.bot) })),
      summary: Array.isArray(raw.summary) ? raw.summary.filter((c: unknown) => typeof c === 'string').slice(-SUMMARY_LINES) : [],
      ended: Boolean(raw.ended),
      world: {
        location: raw.world.location as PlaceId,
        satchel: (Array.isArray(raw.world.satchel) ? raw.world.satchel : []).filter((id: unknown): id is ItemId => typeof id === 'string' && !!itemById(id)),
        chest_open: Boolean(raw.world.chest_open),
        lantern_lit: Boolean(raw.world.lantern_lit),
      },
      saved_at: typeof raw.saved_at === 'number' ? raw.saved_at : 0,
    };
  } catch {
    return null;
  }
}

/** A story is picked up again only when it was under way (a scene had started) and had not ended. */
export const shouldResume = (state: StoryState | null): state is StoryState => Boolean(state && !state.ended && state.scene_index >= 1);

/**
 * Who is in the story after a resume: everyone now in the room with a name keeps their place; players from the saved ledger who have
 * not come back are dropped, except that a saved human is kept when nobody currently in the room has a name (the page sent no name).
 */
export function resumePlayers(saved: readonly SavedPlayer[], here: readonly SavedPlayer[]): SavedPlayer[] {
  const named = here.filter((g) => g.name);
  if (named.length) return named.map((g) => ({ ...g }));
  const humans = saved.filter((p) => !p.bot);
  return (humans.length ? humans : saved).map((p) => ({ ...p }));
}

/** What Old Bram does when he walks back in: a short recap in character, then the story carries on where it stopped. */
export function recapInstructions(state: StoryState, players: readonly SavedPlayer[]): string {
  const names = players.map((p) => p.name).join(' and ');
  const recent = state.summary.length ? `\nWhat was said last:\n${state.summary.join('\n')}` : '';
  const note = placeNote(state.world, { full: false, described: [], replies: 1 });
  return `You have been away from the fire for a moment and you are back. The travellers are ${names || 'the players'}.${recent}
${note}
Do not call any tool. In one or two plain sentences, in character, say where the tale had got to ("Now, where were we?") and what is in front of the travellers. Do not repeat the earlier lines. Speak to the player as "you" and use no name. End on a short open line with no question.${goalDone(state.world) ? ' The quest is already complete.' : ''}`;
}
