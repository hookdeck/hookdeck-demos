/**
 * Pixel is a mute traveller: it never speaks, it gestures. These are the short scripted gesture lines it
 * sends as a chat message when the storyteller gives it the turn, so Pixel takes part with no model call
 * of its own. The storyteller then reacts to the gesture on his normal turn.
 */
export const SCENE_LINES: Record<string, string[]> = {
  tavern: [
    '*Pixel taps the salt-stained map and points at a small drawing of a lantern.*',
    '*Pixel slides the hooded stranger\'s mug a little closer, then raises one eyebrow.*',
    '*Pixel unfolds the map flat on the table and holds the corners down with two spoons.*',
    '*Pixel nods slowly at the stranger and taps two fingers on the table, once.*',
    '*Pixel points at the storm outside, then at the map, then at the door.*',
  ],
  forest: [
    '*Pixel presses a palm to a tree trunk and tilts an ear to the bark.*',
    '*Pixel crouches, brushes the leaves aside and points at a trail of silver footprints.*',
    '*Pixel holds a finger to the wind, then points deeper into the trees.*',
    '*Pixel whistles nothing at all, only mimes it, and the branches seem to lean closer.*',
    '*Pixel ties a scrap of cloth to a low branch to mark the way back.*',
  ],
  cave: [
    '*Pixel holds the lantern up to the cave wall and taps a carving.*',
    '*Pixel counts the drips from the ceiling on four fingers, then points at the dark.*',
    '*Pixel presses a hand to the cold stone and shakes its head, then points left.*',
    '*Pixel cups a hand around its ear, then holds up a finger: something is breathing.*',
    '*Pixel steps forward, stops, and gently sets a spoon on the ground as an offering.*',
  ],
  finale: [
    '*Pixel lifts the Lantern high and walks in front so the others can see the path.*',
    '*Pixel hands the Lantern to the nearest traveller and bows.*',
    '*Pixel points back at the cave, then at the others, then at the sky, and smiles.*',
    '*Pixel taps its chest, then the Lantern, then makes a small circle with both hands.*',
    '*Pixel shields the flame with both hands against the wind and nods: home.*',
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
export function pickGesture(scene: string | undefined, used: Set<string>, random: () => number = Math.random): string {
  const pool = (SCENE_LINES[scene ?? ''] ?? []).filter((line) => !used.has(line));
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
}

export const PIXEL_IDENTITY = 'bot-pixel';

export const readAttributes = (a: Record<string, string>): StoryAttributes => ({
  turn: a['story.turn'],
  turn_seq: a['story.turn_seq'],
  scene: a['story.scene'],
  state: a['story.state'],
  agent_state: a['lk.agent.state'],
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
