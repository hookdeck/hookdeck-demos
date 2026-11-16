/**
 * Pixel is a mute traveller: it never speaks, it gestures. These are the short scripted gesture lines it
 * sends as a chat message when the storyteller gives it the turn, so Pixel takes part with no model call
 * of its own. The storyteller then reacts to the gesture on his normal turn.
 */
/** A gesture line, and the items the party must already carry for it to make sense (a gesture never refers to something the party lacks). */
export interface GestureLine {
  text: string;
  needs?: string[];
}

const L = (text: string, ...needs: string[]): GestureLine => ({ text, needs: needs.length ? needs : undefined });

export const SCENE_LINES: Record<string, GestureLine[]> = {
  tavern: [
    L('*Pixel taps the salt-stained map and points at a small drawing of a lantern.*'),
    L('*Pixel slides the hooded stranger\'s mug a little closer, then raises one eyebrow.*'),
    L('*Pixel unfolds the map flat on the table and holds the corners down with two spoons.*'),
    L('*Pixel nods slowly at the stranger and taps two fingers on the table, once.*'),
    L('*Pixel points at the storm outside, then at the map, then at the door.*'),
    L('*Pixel crouches by the small iron chest and gives its lock a puzzled tug.*'),
  ],
  forest: [
    L('*Pixel presses a palm to a tree trunk and tilts an ear to the bark.*'),
    L('*Pixel crouches, brushes the leaves aside and points at a trail of silver footprints.*'),
    L('*Pixel holds a finger to the wind, then points deeper into the trees.*'),
    L('*Pixel whistles nothing at all, only mimes it, and the branches seem to lean closer.*'),
    L('*Pixel ties a scrap of cloth to a low branch to mark the way back.*'),
    L('*Pixel peers into the hollow oak and points at its small door.*'),
    L('*Pixel turns the small brass key over in its fingers and tilts its head.*', 'brass_key'),
  ],
  cave: [
    L('*Pixel counts the drips from the ceiling on four fingers, then points at the dark.*'),
    L('*Pixel presses a hand to the cold stone and shakes its head, then points left.*'),
    L('*Pixel cups a hand around its ear, then holds up a finger: something is breathing.*'),
    L('*Pixel steps forward, stops, and gently sets a spoon on the ground as an offering.*'),
    L('*Pixel runs a finger along the carving of a boat on the wall.*'),
    L('*Pixel holds the Lantern up to the cave wall and taps a carving.*', 'lantern'),
  ],
  finale: [
    L('*Pixel points back at the cave, then at the others, then at the sky, and smiles.*'),
    L('*Pixel looks up at the dark lamp, then out at the clearing storm.*'),
    L('*Pixel taps the iron chest and mimes turning a key.*', 'brass_key'),
    L('*Pixel lifts the Lantern high and walks in front so the others can see the way.*', 'lantern'),
    L('*Pixel cups both hands around the Lantern and nods: nearly home.*', 'lantern'),
  ],
};

export const FALLBACK_LINES = [
  '*Pixel looks around, gives a small shrug and points ahead.*',
  '*Pixel nods and makes a slow, thoughtful gesture.*',
  '*Pixel steps closer and offers a small, silent smile.*',
];

/**
 * Picks a gesture for the scene that has not been used yet. `used` is updated. When a scene's lines run out
 * it falls back to the generic lines, and when those run out too it starts the generic lines again.
 */
export function pickGesture(scene: string | undefined, used: Set<string>, random: () => number = Math.random, satchel: readonly string[] = []): string {
  const pool = (SCENE_LINES[scene ?? ''] ?? []).filter((line) => (line.needs ?? []).every((id) => satchel.includes(id))).map((line) => line.text).filter((line) => !used.has(line));
  let candidates = pool;
  if (!candidates.length) candidates = FALLBACK_LINES.filter((line) => !used.has(line));
  if (!candidates.length) {
    for (const line of FALLBACK_LINES) used.delete(line);
    candidates = FALLBACK_LINES;
  }
  const line = candidates[Math.floor(random() * candidates.length)];
  used.add(line);
  return line;
}

/** What Pixel sees in the story agent's participant attributes, and what it should do about it. */
export interface StoryAttributes {
  turn?: string;
  turn_seq?: string;
  scene?: string;
  state?: string;
  agent_state?: string;
  /** Item ids the party carries (JSON array in the `story.satchel` attribute). */
  satchel?: string[];
}

export const PIXEL_IDENTITY = 'bot-pixel';

export const readAttributes = (a: Record<string, string>): StoryAttributes => ({
  turn: a['story.turn'],
  turn_seq: a['story.turn_seq'],
  scene: a['story.scene'],
  state: a['story.state'],
  agent_state: a['lk.agent.state'],
  satchel: (() => { try { const v = JSON.parse(a['story.satchel'] || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } })(),
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
