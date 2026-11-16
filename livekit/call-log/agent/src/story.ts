/**
 * The story's shape and pacing, as plain functions so they can be tested without a model.
 *
 * Players drive the pace. A scene ends when the group's choices take them somewhere new, or when
 * Bram offers a clear choice to move on and they take it. There are 2 or 3 exchanges per scene,
 * and a safety limit after which he nudges the group onward.
 */

export interface SceneDef {
  /** The soundtrack the app pulls into the room. */
  scene: 'tavern' | 'forest' | 'cave' | 'finale';
  /** What the players are in, in plain words. */
  place: string;
  /** Concrete things a player can look at or do here. */
  sights: string;
  /** Concrete ways onward, for the choice that moves the group on. Empty for the finale. */
  onward: string;
}

export const SCENES: readonly SceneDef[] = [
  {
    scene: 'tavern',
    place: 'the common room of the Drowned Bell on a stormy night, with a fire, a long table and a hooded stranger',
    sights: 'the stranger has slid a map across the table; the map is marked with a lantern and a path to the Hollow Mere; there is a locked chest by the fire',
    onward: 'leave by the north door into the storm toward the Hollow Wood, or stay and ask the stranger more',
  },
  {
    scene: 'forest',
    place: 'the Hollow Wood, a damp pine forest with two ways forward',
    sights: 'a rope bridge over a stream, a muddy path under the pines, silver footprints in the mud, and a hollow oak with a door in it',
    onward: 'cross the rope bridge to the cave steps by the waterfall, or follow the footprints through the pines',
  },
  {
    scene: 'cave',
    place: 'the cave under the Hollow Mere, dripping and dark, where the Lantern is kept',
    sights: 'a stone ledge with the Lantern on it, a carving of a boat on the wall, drips from the ceiling, and a narrow tunnel and a small rowboat on the underground pool',
    onward: 'take the Lantern and leave by the tunnel, or take it and row across the pool',
  },
  {
    scene: 'finale',
    place: 'the way home with the Lantern, at the shore of the Mere at dawn',
    sights: 'the Lantern is lit, the storm is clearing, and the lights of the Drowned Bell can be seen across the water',
    onward: '',
  },
];

export const MIN_EXCHANGES = 2;
export const SAFETY_EXCHANGES = 5;

export type Guidance = 'open' | 'offer_choice' | 'nudge';

/**
 * What the next give_turn should do. The first exchanges are open. From the minimum on, Bram offers a clear choice
 * to move on, and once the safety limit is reached he nudges the group onward.
 */
export function guidanceFor(exchanges_so_far: number): Guidance {
  if (exchanges_so_far >= SAFETY_EXCHANGES) return 'nudge';
  if (exchanges_so_far >= MIN_EXCHANGES) return 'offer_choice';
  return 'open';
}

/** next_scene is refused until the scene has had its minimum exchanges, unless the safety limit was reached or short mode is on. */
export const canStartNext = (exchanges_so_far: number, short_mode: boolean) => short_mode || exchanges_so_far >= MIN_EXCHANGES;

/** Test-only short mode (STORY_SHORT=1): after the first scene the story jumps to the finale. */
export function nextSceneIndex(scenes_started: number, short_mode: boolean): number {
  return short_mode && scenes_started === 1 ? SCENES.length - 1 : scenes_started;
}

/**
 * Waits for the end of the story's last speech before it finishes. `armed` is set when end_story is called. Whenever the
 * agent stops speaking, a pause starts; if the agent starts speaking or thinking again in that time (a farewell after the
 * tool result, for example) the pause is cancelled. When the pause runs out, `finish` is called once.
 */
export function createEndWatcher(finish: () => void, pause_ms = 2000, timers = { set: setTimeout, clear: clearTimeout }) {
  let armed = false;
  let done = false;
  let handle: ReturnType<typeof setTimeout> | undefined;
  return {
    arm() { armed = true; },
    onAgentState(_old: string, next: string) {
      if (!armed || done) return;
      if (next === 'listening' || next === 'idle') {
        timers.clear(handle);
        handle = timers.set(() => { if (!done) { done = true; finish(); } }, pause_ms);
      } else timers.clear(handle);
    },
  };
}

/** After a mute player's turn the listener goes back to a player who can speak (the first one), so their answer is heard. */
export const speakerAfterMute = <T extends { bot: boolean }>(players: T[]): T | undefined => players.find((p) => !p.bot);
