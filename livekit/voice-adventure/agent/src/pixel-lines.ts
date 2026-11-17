/**
 * Pixel is a mute traveller: it never speaks, it gestures. The story agent picks the gesture line for Pixel's turn (so the line fits
 * the place and what the party carries) and publishes it; Pixel sends it as a chat message after a short delay. The storyteller
 * reacts to the gesture on his normal turn.
 */
import { itemsHere, type ItemId, type PlaceId, type World } from './world.ts';

/** A gesture line, and what must be true for it to make sense. A gesture never refers to something the party does not have. */
export interface GestureLine {
  text: string;
  /** Items the party must already carry. */
  needs?: ItemId[];
  /** Items that must still be lying in this place (so Pixel points at something that is there). */
  here?: ItemId[];
}

const L = (text: string, o: { needs?: ItemId[]; here?: ItemId[] } = {}): GestureLine => ({ text, ...o });

export const SCENE_LINES: Record<PlaceId, GestureLine[]> = {
  tavern: [
    L('*Pixel taps the salt-stained map and points at a small drawing of a lantern.*', { here: ['map'] }),
    L('*Pixel slides the hooded stranger\'s mug a little closer, then raises one eyebrow.*'),
    L('*Pixel nods slowly at the stranger and taps two fingers on the table, once.*'),
    L('*Pixel points at the north door, then at the storm outside.*'),
    L('*Pixel gives the lock of the small iron chest a puzzled tug.*'),
    L('*Pixel peers at the back door and the dark shore beyond it.*'),
  ],
  forest: [
    L('*Pixel presses a palm to a tree trunk and tilts an ear to the bark.*'),
    L('*Pixel crouches, brushes the leaves aside and points at a trail of silver footprints.*'),
    L('*Pixel holds a finger to the wind, then points deeper into the trees.*'),
    L('*Pixel points at the hollow oak and its small door.*'),
    L('*Pixel peers over the rope bridge at the stream below.*'),
    L('*Pixel ties a scrap of cloth to a low branch to mark the way back.*'),
  ],
  oak: [
    L('*Pixel runs a finger along the root shelf and taps it twice.*'),
    L('*Pixel points at the small brass key on the shelf.*', { here: ['brass_key'] }),
    L('*Pixel sniffs the resin-scented air and wrinkles its nose.*'),
    L('*Pixel peeks back out through the little door at the storm.*'),
  ],
  cave: [
    L('*Pixel counts the drips from the ceiling on four fingers, then points at the dark.*'),
    L('*Pixel runs a finger along the carving of a boat on the wall.*'),
    L('*Pixel points at the Lantern on the stone ledge.*', { here: ['lantern'] }),
    L('*Pixel presses a hand to the cold stone and shakes its head.*'),
    L('*Pixel points at the rowboat on the pool.*'),
    L('*Pixel holds the Lantern up to the cave wall and taps the carving.*', { needs: ['lantern'] }),
  ],
  lighthouse: [
    L('*Pixel looks up at the dark lamp, then out at the clearing storm.*'),
    L('*Pixel runs a hand along the salt-streaked wall and smiles.*'),
    L('*Pixel cups both hands around the Lantern and nods: nearly home.*', { needs: ['lantern'] }),
    L('*Pixel points down the shore path to the Drowned Bell.*'),
  ],
};

/** Lines that fit anywhere, with no item needs: the weather, a sound, the stranger, an exit, copying someone. A place never runs dry of them. */
export const GENERIC_LINES: GestureLine[] = [
  L('*Pixel listens to the storm and pulls its collar up.*'),
  L('*Pixel tilts its head at a faint sound in the distance.*'),
  L('*Pixel glances at the hooded stranger\'s boots, then away.*'),
  L('*Pixel points at the nearest way out, then at the others.*'),
  L('*Pixel copies the last thing the others did, a beat late, and shrugs.*'),
  L('*Pixel nods along and taps a foot.*'),
  L('*Pixel peers around and rubs its hands against the cold.*'),
];

/** Pixel's answers when a player speaks to it: it responds to what was asked, never with words. */
export const RESPONDING_LINES: GestureLine[] = [
  L('*Pixel tilts its head, considers, and nods slowly.*'),
  L('*Pixel shrugs and spreads both hands, as if to say: not sure.*'),
  L('*Pixel taps its chin, then holds up one finger: wait.*'),
  L('*Pixel gives a firm thumbs up and a small grin.*'),
];

/** Things Pixel points at when it answers, by place: something real that is there. */
export const POINTING_RESPONSES: Record<PlaceId, string> = {
  tavern: '*Pixel points at the north door, then at the storm outside, and raises an eyebrow.*',
  forest: '*Pixel points at the hollow oak and its small door.*',
  oak: '*Pixel points at the little door back out to the wood.*',
  cave: '*Pixel points at the rowboat on the dark pool.*',
  lighthouse: '*Pixel points at the dark lamp above.*',
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
    (line.needs ?? []).every((id) => world.satchel.includes(id)) && (line.here ?? []).every((id) => here.has(id)));
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

/** What Pixel sees in the story agent's participant attributes, and what it should do about it. */
export interface StoryAttributes {
  turn?: string;
  turn_seq?: string;
  scene?: string;
  state?: string;
  agent_state?: string;
  /** The gesture the story agent chose for Pixel's turn. */
  line?: string;
}

export const PIXEL_IDENTITY = 'bot-pixel';

export const readAttributes = (a: Record<string, string>): StoryAttributes => ({
  turn: a['story.turn'],
  turn_seq: a['story.turn_seq'],
  scene: a['story.scene'],
  state: a['story.state'],
  agent_state: a['lk.agent.state'],
  line: a['story.pixel_line'],
});

/**
 * Pixel's turn trigger. A turn is new when `story.turn` is Pixel's identity and `story.turn_seq` (counted by the
 * storyteller on every give_turn) has changed since Pixel last answered. The storyteller's give_turn tool is
 * waiting for the gesture, so Pixel answers after its short delay whatever state the agent is in.
 */
export function shouldGesture(attrs: StoryAttributes, last_answered_seq: string | undefined): 'gesture' | 'idle' {
  if (attrs.turn !== PIXEL_IDENTITY) return 'idle';
  return attrs.turn_seq === last_answered_seq ? 'idle' : 'gesture';
}

/** Pixel waits one to three seconds before it gestures. */
export const gestureDelayMs = (random: () => number = Math.random) => 1000 + Math.floor(random() * 2000);
