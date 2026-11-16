import { ReadableStream, TransformStream, type TransformStreamDefaultController } from 'node:stream/web';

/**
 * The story's shape and pacing, as plain functions so they can be tested without a model.
 *
 * Players drive the pace, with no timing pressure. A scene changes only when a player clearly chooses to move on.
 */

export interface SceneDef {
  /** The soundtrack the app pulls into the room. */
  scene: 'tavern' | 'forest' | 'cave' | 'finale';
  /** What the players are in, in plain words. */
  place: string;
  /** What they can see, hear and notice: observations only, never an action to take. */
  sights: string;
  /** The exits, described as part of the place. Empty for the finale. */
  onward: string;
  /** Things to find. Bram reveals one only when a player investigates that thing. */
  clue: string;
}

export const SCENES: readonly SceneDef[] = [
  {
    scene: 'tavern',
    place: 'the common room of the Drowned Bell on a stormy night, with a fire, a long table and a hooded stranger',
    sights: 'rain on the shutters, the fire popping, a salt-stained map on the table in front of the stranger, a small iron chest under the bench with its lock rusted shut',
    onward: 'a north door leads out into the storm toward the Hollow Wood',
    clue: 'the map has a lantern drawn near the Hollow Mere and a margin note about dripping water; the stranger knows the way and says so only if asked',
  },
  {
    scene: 'forest',
    place: 'the Hollow Wood, a damp pine forest',
    sights: 'a rope bridge over a stream, a muddy path under the pines, silver footprints in the mud, a hollow oak with a small door in its trunk',
    onward: 'the rope bridge leads to stone steps beside a waterfall, and the footprints go on through the pines',
    clue: 'the footprints are small and lead to the door in the oak; the steps beside the waterfall go down toward the Mere',
  },
  {
    scene: 'cave',
    place: 'the cave under the Hollow Mere, dripping and dark',
    sights: 'a stone ledge with the Lantern on it, drips from the ceiling, a carving on the wall, a narrow tunnel and a small rowboat on the underground pool',
    onward: 'a narrow tunnel leads up and out, and the rowboat sits at the edge of the pool',
    clue: 'the carving shows a boat crossing the pool toward a light',
  },
  {
    scene: 'finale',
    place: 'the shore of the Mere at dawn, with the Lantern lit',
    sights: 'the storm clearing, the Lantern burning steadily, the lights of the Drowned Bell across the water',
    onward: '',
    clue: '',
  },
];

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

export type MoveOnVerdict = 'ok' | 'no_new_input';

/**
 * next_scene (and end_story) are allowed only in the reply that answers a player's input, never chained after another
 * call. There is no minimum number of exchanges and no nudge: the players are free to explore, and a scene changes when a
 * player clearly chooses to move on. A refusal returns nothing, so Bram does not speak again.
 */
export function moveOnVerdict(input_since_last_call: boolean): MoveOnVerdict {
  return input_since_last_call ? 'ok' : 'no_new_input';
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

// ---- A watchdog for a model request that never answers ----

/**
 * Armed when a player has finished and Bram owes a reply. Anything that shows progress (he starts speaking) clears it. If
 * nothing happens for `ms` the stall callback runs once, so the player is not left waiting on a hung request.
 */
export function createLlmWatchdog(on_stall: () => void, ms = 20000, timers = { set: setTimeout, clear: clearTimeout }) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return {
    arm() {
      timers.clear(handle);
      handle = timers.set(() => { handle = undefined; on_stall(); }, ms);
    },
    progress() {
      timers.clear(handle);
      handle = undefined;
    },
    get armed() { return handle !== undefined; },
  };
}

/** One short in-character line for when the storyteller lost the thread, spoken straight through text-to-speech. */
export function stallLine(player_name: string | undefined, variant = 0): string {
  const who = player_name ?? 'friend';
  return [
    `Ah, the tide took my words for a moment. Say that again for me, ${who}.`,
    `Forgive an old keeper, ${who}, I lost the thread there. What was it you said?`,
  ][variant % 2];
}


// ---- What Bram is told: describe, don't direct ----

export const BREVITY = 'You speak aloud, so keep to two short sentences at a time, with no lists, no stage directions and no emoji.';

/** Bad lines, shown to Bram only as examples of what never to say. The prompt tests skip this block. */
export const LEADING_BLOCK_START = '[never say lines like these]';
export const LEADING_BLOCK_END = '[end of lines never to say]';

/** What is true of the scene right now, given to Bram as a system message before each reply to a player. */
export function sceneHint(scene_index: number, ending: boolean): string {
  const scene = scene_index > 0 ? SCENES[Math.min(scene_index, SCENES.length) - 1] : undefined;
  const finale = scene_index >= SCENES.length;
  const where = scene
    ? `Current scene (${scene_index} of ${SCENES.length}): ${scene.place}. What can be seen and heard: ${scene.sights}.${finale ? '' : ` The way out, to mention only as part of the place: ${scene.onward}.`}${scene.clue ? ` Things to find, revealed only when a player investigates that thing: ${scene.clue}.` : ''}`
    : 'The story has not started: call next_scene.';
  const phase = ending
    ? 'The story is ending: speak your closing only.'
    : finale
      ? 'This is the finale. Let the players take their time and respond to what they try. When each has had their moment, or a player says they are done, call end_story, and after it answers speak your closing.'
      : 'Let the players explore as long as they like. Respond to what they actually try, including the unexpected: say what happens and let consequences follow. Call next_scene only when a player clearly chooses to move on.';
  return `${where} ${phase}`;
}

/** Bram's standing instructions: who he is, how he speaks, how he describes and hands over. */
export function bramInstructions(players: Array<{ name: string; bot: boolean }>): string {
  const example_name = players.find((p) => !p.bot)?.name ?? 'traveller';
  const roster = players.map((p) => (p.bot ? `${p.name} (a mute traveller who cannot speak: what ${p.name} does arrives as a message like "${p.name} taps the map.")` : p.name)).join(', ');
  const mute = players.some((p) => p.bot) ? ' A mute traveller never decides anything: its gestures can show the way, but only a spoken decision from a player moves the group on.' : '';
  return `You are Old Bram Tallow, a retired lighthouse keeper who tells stories at the Drowned Bell: warm, gravelly and kind. You are a fictional character telling "The Lantern of Hollow Mere" to these travellers and only these: ${roster}. ${BREVITY}
Speak plainly, with at most one sea-worn phrase per reply, and none is fine. No riddles.
Describe, don't direct. Say what the players see, hear and notice. Never tell them what to do, never ask whether they would like to do something, and never put an object next to the action that solves it. Write "A small iron chest sits under the bench, its lock rusted shut." and stop there.
${LEADING_BLOCK_START} "Would you like to search the room to find something to open the chest?" "Why not follow the footprints?" "Maybe you could use the key on the door." ${LEADING_BLOCK_END}
Good lines describe only: "A small iron chest sits under the bench, its lock rusted shut." "Silver footprints lead off into the pines." "The stranger watches you over the rim of his mug."
Clues sit in the scene for the players to find. Reveal a clue only when a player investigates that thing. If a player says they are stuck or asks for a hint, give one gentle nudge about something to look at, never the solution.
Respond to what the players actually try, including the unexpected: say what happens and let consequences follow.
End each reply on the description or on what happens. Never tack a name or a question onto the end ("${example_name}?", "What do you do?"): the page already shows whose turn it is. Use a player's name only where it fits naturally inside a sentence, for example when reacting to what they did, and only the names of the travellers listed above, never a name from an example. Never point at an action. Then stop and wait: you never answer for the players and never continue until a player has spoken. Rotate between the players.${mute} Never ask two questions in one reply.
Each reply to a player is preceded by a system note about the current scene: follow it. You have only two tools, next_scene and end_story. Call a tool only when the note says to, never to push the group on, and never write or say a tool name or function call in your speech.`;
}

/** What next_scene returns to Bram when a scene starts. */
export function sceneStartNote(index: number, music: string): string {
  const { place, sights, onward, clue } = SCENES[index];
  const finale = index === SCENES.length - 1;
  return `Scene ${index + 1} of ${SCENES.length} has started ${music}. Place: ${place}. What can be seen and heard: ${sights}.${finale ? ' This is the finale.' : ` The way out, to mention only as part of the place: ${onward}.`}${clue ? ` Things to find, revealed only when a player investigates that thing: ${clue}.` : ''} Describe the place in two short plain sentences using some of what can be seen and heard, then hand over with a short open prompt naming the player who goes first.`;
}


/**
 * Recovery for a user turn that never ends. A final transcript arms it; when the agent starts thinking or speaking, or the
 * user turn completes, it is cleared. If nothing happens for `ms` the first stage forces the turn to end (`commit`) and waits
 * once more; if that also produces nothing, the second stage says the in-character "say that again" line (`say_again`).
 */
export function createTurnRecovery(actions: { commit: () => void; say_again: () => void }, ms = 15000, timers = { set: setTimeout, clear: clearTimeout }) {
  let stage = 0;
  const watchdog = createLlmWatchdog(() => {
    if (stage === 0) {
      stage = 1;
      actions.commit();
      watchdog.arm();
    } else {
      stage = 0;
      actions.say_again();
    }
  }, ms, timers);
  return {
    onFinalTranscript() { stage = 0; watchdog.arm(); },
    onProgress() { stage = 0; watchdog.progress(); },
    get stage() { return stage; },
  };
}
