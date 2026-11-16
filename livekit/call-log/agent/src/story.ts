import { ReadableStream, TransformStream, type TransformStreamDefaultController } from 'node:stream/web';

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

// ---- Turns are code, not a model tool ----

export interface Addressable {
  name: string;
  identity: string;
  bot: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The player Bram names last in his reply (he ends a reply by naming who answers next), if he names one. */
export function addressedPlayer<T extends Addressable>(text: string, players: T[]): T | undefined {
  let best: { player: T; at: number } | undefined;
  for (const player of players) {
    const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(player.name)}(?![\\p{L}])`, 'giu');
    for (const m of text.matchAll(re)) if (!best || m.index! >= best.at) best = { player, at: m.index! };
  }
  return best?.player;
}

/** Who has the next turn: the player Bram named, or else the next one in the rotation. Returns the index into `players`. */
export function nextSpeakerIndex<T extends Addressable>(players: T[], last_index: number, reply: string): number {
  if (!players.length) return -1;
  const named = addressedPlayer(reply, players);
  return named ? players.indexOf(named) : (last_index + 1) % players.length;
}

export type MoveOnVerdict = 'ok' | 'too_early' | 'no_new_input';

/**
 * next_scene (and end_story) are allowed only in the reply that answers a player's input (not chained after another
 * call), and only once the scene has had its minimum real player inputs. A refusal returns nothing, so Bram does not speak again.
 */
export function moveOnVerdict(inputs_in_scene: number, input_since_last_call: boolean, short_mode: boolean): MoveOnVerdict {
  if (!input_since_last_call) return 'no_new_input';
  if (!short_mode && inputs_in_scene < MIN_EXCHANGES) return 'too_early';
  return 'ok';
}

// ---- A backstop so the model never speaks a tool name ----

export const TOOL_NAMES = ['next_scene', 'end_story', 'write_in_ledger', 'fetch_bram', 'give_turn'];
const SPOKEN_CALL = new RegExp(`(?:functions\\.)?(?:${TOOL_NAMES.join('|')})(?:\\s*\\([^)]*\\)?)?|functions\\.\\w*(?:\\s*\\([^)]*\\)?)?`, 'gi');

/** Removes tool calls and tool names from text that is about to be spoken. Returns the cleaned text and whether it removed anything. */
export function cleanSpeech(text: string): { text: string; removed: boolean } {
  const removed = new RegExp(SPOKEN_CALL.source, 'i').test(text);
  return { text: removed ? text.replace(SPOKEN_CALL, '').replace(/ {2,}/g, ' ') : text, removed };
}

/**
 * A stream transform for the session's `ttsTextTransforms`. Text arrives in small pieces ("next_" then "scene"), so it
 * holds back the end of what it has seen until a word boundary or the end of the stream, and cleans what it releases.
 */
export function speechFilter(on_removed: (what: string) => void = () => undefined) {
  return (input: ReadableStream<string>): ReadableStream<string> => {
    let held = '';
    const release = (controller: TransformStreamDefaultController<string>, all: boolean) => {
      // Hold back from the last space, and from an open "functions." or tool-name-length tail, unless it is the end
      const cut = all ? held.length : Math.max(held.lastIndexOf(' '), held.lastIndexOf('\n'), held.lastIndexOf('.') >= 0 && !/functions\.?\w*$/i.test(held) ? held.lastIndexOf('.') : -1) + 1;
      if (cut <= 0) return;
      const { text, removed } = cleanSpeech(held.slice(0, cut));
      if (removed) on_removed(held.slice(0, cut).trim());
      held = held.slice(cut);
      if (text) controller.enqueue(text);
    };
    return input.pipeThrough(new TransformStream<string, string>({
      transform(chunk, controller) { held += chunk; release(controller, false); },
      flush(controller) { release(controller, true); },
    }));
  };
}

// ---- The turn state machine ----

/** The fields of the story's state that turns and move-on guards depend on. */
export interface TurnState {
  scene_index: number;
  /** Real player inputs in the current scene. */
  inputs: number;
  /** A player has spoken or gestured since the last tool call. */
  input_since_call: boolean;
  last_reply: string;
  /** Index of the player who had the last turn. */
  rotation: number;
  ending: boolean;
  short_mode: boolean;
}

/** A final transcript from the linked player, or Pixel's chat gesture. The only thing that counts as an exchange. */
export function onPlayerInput(s: TurnState) {
  s.inputs += 1;
  s.input_since_call = true;
}

export function onBramReply(s: TurnState, text: string) {
  s.last_reply = text;
}

/** Bram has finished speaking: who gets the turn now (the player he named, or the next in rotation), or nobody. */
export function onPlayout<T extends Addressable>(s: TurnState, players: T[]): T | undefined {
  if (s.ending || s.scene_index === 0) return undefined;
  const index = nextSpeakerIndex(players, s.rotation, s.last_reply);
  if (index < 0) return undefined;
  s.rotation = index;
  return players[index];
}

/** Starts a scene: the scene's own count of inputs starts over. */
export function onSceneStart(s: TurnState, index: number) {
  s.scene_index = index + 1;
  s.inputs = 0;
  s.input_since_call = false;
}
