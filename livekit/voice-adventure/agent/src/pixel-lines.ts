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

/** A line is not used again for this many turns. */
export const COOLDOWN_TURNS = 6;

/**
 * Picks a gesture for Pixel's turn: a line for this place that makes sense for what the party carries and what still lies here, and
 * that has not been used in the last COOLDOWN_TURNS turns. When no line qualifies it returns undefined and Pixel skips the turn
 * (there is no filler gesture). `cooldown` is updated with the turn the line was used on.
 */
export function pickGesture(world: World, cooldown: Map<string, number>, turn_no: number, random: () => number = Math.random): string | undefined {
  const here = new Set(itemsHere(world).map((i) => i.id));
  const eligible = SCENE_LINES[world.location].filter((line) => {
    if (!(line.needs ?? []).every((id) => world.satchel.includes(id))) return false;
    if (!(line.here ?? []).every((id) => here.has(id))) return false;
    const last = cooldown.get(line.text);
    return last === undefined || turn_no - last >= COOLDOWN_TURNS;
  });
  if (!eligible.length) return undefined;
  const line = eligible[Math.floor(random() * eligible.length)].text;
  cooldown.set(line, turn_no);
  return line;
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
