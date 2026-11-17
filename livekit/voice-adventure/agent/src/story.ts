import { sightsOf, usedDetails, type PlaceId, type World } from './world.ts';
import { ReadableStream, TransformStream, type TransformStreamDefaultController } from 'node:stream/web';

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

// ---- A backstop so the model never speaks a tool name ----

export const TOOL_NAMES = ['next_scene', 'end_story', 'take_item', 'use_item', 'move_to', 'write_in_ledger', 'fetch_bram', 'give_turn'];
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
  short_mode?: boolean;
  /** Where the party is. */
  location?: PlaceId;
  /** The state of the world: what can be seen is built from it. */
  world?: World;
  /** Bram's replies since the scene began (the arrival description is the first), and the sights he has already used in them. */
  replies_in_scene?: number;
  described?: string[];
  /** An item tool already ran for this player input: one per reply. */
  item_acted?: boolean;
}

/** A final transcript from the linked player, or Pixel's chat gesture. The only thing that counts as an exchange. */
export function onPlayerInput(s: TurnState) {
  s.inputs += 1;
  s.item_acted = false;
  s.input_since_call = true;
}

export function onBramReply(s: TurnState, text: string) {
  s.last_reply = text;
  s.replies_in_scene = (s.replies_in_scene ?? 0) + 1;
  // What Bram has now described is judged against what can be seen now, so a thing that changed (the chest, now open) counts as new
  if (s.world) s.described = [...new Set([...(s.described ?? []), ...usedDetails(sightsOf(s.world), text)])];
}

/** Bram has finished speaking: who gets the turn now (the player he named, or the next in rotation), or nobody. */
/**
 * Bram has finished speaking: who gets the next turn, among the human players only. The mute player is never in the rotation: nothing
 * waits for it, and it acts only as an extra around a human turn (when addressed, or once on arriving somewhere).
 */
export function onPlayout<T extends Addressable>(s: TurnState, players: T[]): T | undefined {
  if (s.ending || s.scene_index === 0) return undefined;
  const humans = players.filter((p) => !p.bot);
  const pool = humans.length ? humans : players;
  const last = pool.indexOf(players[s.rotation]);
  const index = nextSpeakerIndex(pool, last, s.last_reply);
  if (index < 0) return undefined;
  s.rotation = players.indexOf(pool[index]);
  return pool[index];
}

/** The party arrives at a place: this place's own count of inputs and replies starts over. */
export function onSceneStart(s: TurnState, location: PlaceId) {
  s.scene_index += 1;
  s.location = location;
  s.inputs = 0;
  s.input_since_call = false;
  s.replies_in_scene = 0;
  s.described = [];
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


/** Bram's standing instructions: who he is, how he speaks, how he describes and hands over. */
export function bramInstructions(players: Array<{ name: string; bot: boolean }>): string {
  const humans = players.filter((p) => !p.bot);
  const roster = players.map((p) => (p.bot ? `${p.name} (a mute traveller who cannot speak: what ${p.name} does arrives as a message like "${p.name} taps the map.")` : p.name)).join(', ');
  const mute = players.some((p) => p.bot) ? ' A mute traveller never decides anything: its gestures can show the way, but only a spoken decision from a player moves the group on.' : '';
  const names = humans.length > 1
    ? 'There is more than one human player: address the player who just spoke as "you", and use a name only when you need to say which of the players you mean.'
    : 'There is one human player: after your greeting never use their name at all. Address them as "you".';
  return `You are Old Bram Tallow, a retired lighthouse keeper who tells stories at the Drowned Bell: warm, gravelly and kind. You are a fictional character telling "The Lantern of Hollow Mere" to these travellers and only these: ${roster}. ${BREVITY}
The goal, which you state plainly once when you open: your lighthouse went dark in the storm, and only the Lantern of Hollow Mere can relight it. Say it as "my lighthouse".
Speak plainly, with at most one sea-worn phrase per reply, and none is fine. No riddles.
Describe, don't direct. Say what the players see, hear and notice, and where each thing lies. Never tell them what to do, never ask whether they would like to do something, and never put an object next to the action that solves it. Write "A small iron chest sits under the bench, locked." and stop there.
${LEADING_BLOCK_START} "Would you like to search the room to find something to open the chest?" "Why not follow the footprints?" "Maybe you could use the key on the door." ${LEADING_BLOCK_END}
Good lines describe only: "A small iron chest sits under the bench, locked." "Silver footprints lead off into the pines." "The stranger watches you over the rim of his mug."
Clues sit in the scene for the players to find. Reveal a clue only when a player investigates that thing. If a player says they are stuck or asks for a hint, give one gentle nudge about something to look at, never the solution.
Respond to what the players actually try, including the unexpected: say what happens and let consequences follow. Never invent items, doors, places or puzzles that the scene note does not give you, and never describe the party being anywhere but where the note says.
Describe a place in full only when you arrive in it. After that, never restate the setting (the weather, the fire, the map): answer what the player did, in one or two sentences, and mention a sight or sound only if it is new, has changed, or matters to what they just did.
Names. Speak to the player as "you": never talk about the player you are answering in the third person ("Snaggle is beside you now", "the stranger falls in behind Snaggle"). ${names} Never put a name at the start or the end of a reply ("Snaggle, the way is before you"). If a player tells you their name or corrects it ("I'm Snaggle"), acknowledge it in a few words and use it from then on only as the rules above allow. Use only the names of the travellers listed above.
End each reply on the description or on what happens, with no question and no name tacked on: the page already shows whose turn it is. Never point at an action. Then stop and wait: you never answer for the players and never continue until a player has spoken. Rotate between the players.${mute} Never ask two questions in one reply.
Each reply to a player is preceded by a system note: it says where the party is, what lies here, what is in the satchel, the ways out and what just happened. Follow it exactly and narrate what it says happened, plainly, as fact. You have no tools: never write or say a tool name or function call in your speech.`;
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

