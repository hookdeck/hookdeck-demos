/**
 * Pixel is a mute traveller: it never speaks, it gestures. The story agent picks the gesture line for Pixel's turn (so the line fits
 * the place and what the party carries) and publishes it; Pixel sends it as a chat message after a short delay. The storyteller
 * reacts to the gesture on his normal turn.
 */
import { itemsHere, type ItemId, type PlaceId, type World } from './world.ts';

/** A gesture line, and what must be true for it to make sense. A gesture never refers to something that is no longer so. */
export interface GestureLine {
  text: string;
  /** Items the party must already carry. */
  needs?: ItemId[];
  /** Items that must still be lying in this place (so Pixel points at something that is there). */
  here?: ItemId[];
  /** Puzzle flags that must have this value (the chest is still shut, the Lantern is not yet lit). */
  flags?: { chest_open?: boolean; lantern_lit?: boolean };
}

const L = (text: string, o: Omit<GestureLine, 'text'> = {}): GestureLine => ({ text, ...o });

// Few lines, each one a small reaction to something that is really there. Pixel adds colour; it never carries the story.
export const SCENE_LINES: Record<PlaceId, GestureLine[]> = {
  tavern: [
    L('*Pixel taps the salt-stained map and points at a small drawing of a lantern.*', { here: ['map'] }),
    L('*Pixel gives the lock of the small iron chest a puzzled tug.*', { flags: { chest_open: false } }),
    L('*Pixel peers into the open chest and grins.*', { flags: { chest_open: true } }),
  ],
  forest: [
    L('*Pixel crouches, brushes the leaves aside and points at a trail of silver footprints.*'),
    L('*Pixel points at the hollow oak and its small door.*'),
  ],
  oak: [
    L('*Pixel points at the small brass key on the shelf.*', { here: ['brass_key'] }),
    L('*Pixel sniffs the resin-scented air and wrinkles its nose.*'),
  ],
  cave: [
    L('*Pixel points at the Lantern on the stone ledge.*', { here: ['lantern'] }),
    L('*Pixel points at the rowboat on the dark pool.*'),
  ],
  lighthouse: [
    L('*Pixel looks up at the dark lamp, then out at the clearing storm.*', { flags: { lantern_lit: false } }),
    L('*Pixel cups both hands around the Lantern and nods: nearly home.*', { needs: ['lantern'], flags: { lantern_lit: false } }),
  ],
};

/** Lines that fit anywhere, with no item needs. */
export const GENERIC_LINES: GestureLine[] = [
  L('*Pixel listens to the storm and pulls its collar up.*'),
  L('*Pixel tilts its head at a faint sound in the distance.*'),
  L('*Pixel points at the nearest way out, then at the others.*'),
  L('*Pixel nods along and taps a foot.*'),
];

/** Pixel's answers when a player speaks to it: it responds to what was asked, never with words. */
export const RESPONDING_LINES: GestureLine[] = [
  L('*Pixel tilts its head, considers, and nods slowly.*'),
  L('*Pixel shrugs and spreads both hands, as if to say: not sure.*'),
  L('*Pixel gives a firm thumbs up and a small grin.*'),
];

/** Things Pixel points at when it answers, by place: something real that is there. */
export const POINTING_RESPONSES: Record<PlaceId, string> = {
  tavern: '*Pixel points at the north door, then at the storm outside, and raises an eyebrow.*',
  forest: '*Pixel points at the hollow oak and its small door.*',
  oak: '*Pixel points at the little door back out to the wood.*',
  cave: '*Pixel points at the rowboat on the dark pool.*',
  lighthouse: '*Pixel points up at the lamp room.*',
};

/** A line is not used again for this many turns. */
export const COOLDOWN_TURNS = 6;

export type GestureChoice = { line: string; reason?: undefined } | { line?: undefined; reason: 'no eligible line' | 'cooldown' };

/**
 * Picks a gesture for Pixel's turn: a line for this place that makes sense for what the party carries and what still lies here (or
 * one of the generic lines that fit anywhere), not used in the last COOLDOWN_TURNS turns. When none qualifies the reason says why
 * (nothing eligible at all, or everything eligible is cooling down) and Pixel skips the turn. `cooldown` records the turn a line was used on.
 */
export function chooseGesture(world: World, cooldown: Map<string, number>, turn_no: number, random: () => number = Math.random): GestureChoice {
  const here = new Set(itemsHere(world).map((i) => i.id));
  const fits = [...SCENE_LINES[world.location], ...GENERIC_LINES].filter((line) =>
    (line.needs ?? []).every((id) => world.satchel.includes(id)) && (line.here ?? []).every((id) => here.has(id))
    && (line.flags?.chest_open === undefined || line.flags.chest_open === world.chest_open)
    && (line.flags?.lantern_lit === undefined || line.flags.lantern_lit === world.lantern_lit));
  if (!fits.length) return { reason: 'no eligible line' };
  const eligible = fits.filter((line) => {
    const last = cooldown.get(line.text);
    return last === undefined || turn_no - last >= COOLDOWN_TURNS;
  });
  if (!eligible.length) return { reason: 'cooldown' };
  const line = eligible[Math.floor(random() * eligible.length)].text;
  cooldown.set(line, turn_no);
  return { line };
}

export const pickGesture = (world: World, cooldown: Map<string, number>, turn_no: number, random: () => number = Math.random): string | undefined => chooseGesture(world, cooldown, turn_no, random).line;

/** Pixel's answer when addressed: handed an item, it takes it; otherwise a response, or a pointer at something here. */
export function respondLine(world: World, gave_label: string | undefined, random: () => number = Math.random): string {
  if (gave_label) return `*Pixel takes ${gave_label} with a small bow and tucks it away.*`;
  const options = [...RESPONDING_LINES.map((l) => l.text), POINTING_RESPONSES[world.location]];
  return options[Math.floor(random() * options.length)];
}

/** What Pixel sees in the story agent's participant attributes. */
export interface StoryAttributes {
  state?: string;
  /** A counter the agent bumps each time it wants Pixel to act, and the gesture for that moment. Pixel never holds a turn. */
  pixel_seq?: string;
  line?: string;
}

export const PIXEL_IDENTITY = 'bot-pixel';

export const readAttributes = (a: Record<string, string>): StoryAttributes => ({
  state: a['story.state'],
  pixel_seq: a['story.pixel_seq'],
  line: a['story.pixel_line'],
});

/**
 * Whether Pixel should send a gesture now: the agent published a new sequence number with a line. Pixel acts only on that. It does
 * not wait for a turn and nothing waits for it: the gesture goes into the transcript, and the storyteller weaves it into a reply.
 */
export function shouldGesture(attrs: StoryAttributes, last_seq: string | undefined): 'gesture' | 'idle' {
  if (!attrs.pixel_seq || !attrs.line) return 'idle';
  return attrs.pixel_seq === last_seq ? 'idle' : 'gesture';
}

/** Pixel waits one to three seconds before it gestures. */
export const gestureDelayMs = (random: () => number = Math.random) => 1000 + Math.floor(random() * 2000);
