/**
 * The two characters of story night: Hester Pennywhistle, the innkeeper of the Drowned Bell, who greets
 * travellers at the door and writes each name in her ledger, and Old Bram Tallow, a retired lighthouse
 * keeper who tells the adventure. Both are fictional. They are one agent participant in the room, handed
 * off when Hester says she will fetch Bram. The code decides what happens (a small model call reads each player input into
 * moves, takes, uses and gives, and the code validates and applies them); Bram only narrates. When the party moves to a place with a
 * different soundtrack, the demo app pulls it into the room with LiveKit's Ingress API.
 *
 * Speech-to-text, the language model and text-to-speech all run on LiveKit Inference, so the only
 * credentials are the LiveKit project's API key and secret. Run it with `npm run agent`.
 *
 * The agent publishes what the page needs as participant attributes on its own participant:
 * `story.character` (who is speaking), `story.turn` and `story.turn_name` (whose turn it is),
 * `story.scene` and `story.place` (the place id and its name), `story.satchel`, `story.state` (`playing` or `ended`).
 */
import { type JobContext, ServerOptions, cli, defineAgent, inference, llm, voice } from '@livekit/agents';
import { ParticipantKind, type RemoteParticipant } from '@livekit/rtc-node';
import { RoomServiceClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { exitsByDestination, itemById, itemNamed, matchDestination, normalizeItem, PLACES, actionPrompt, addressesPixel, applyActions, closingNote, endTriggered, noActions, parseActions, parseNameCorrection, placeNote, satchelAttribute, usesName, worldAt, type PlaceId, type World } from './world.ts';
import { askShort, describeLlm, makeLlm } from './llm.ts';
import { botName, fetchLine, planLedger, shouldFetchBram } from './names.ts';
import { chooseGesture, respondLine } from './pixel-lines.ts';
import { addSummaryLine, buildState, decodeState, encodeState, recapInstructions, resumePlayers, shouldResume, type StoryState } from './resume.ts';
import { BREVITY, bramInstructions, createEndWatcher, onBramReply, onPlayerInput, onPlayout, onSceneStart, speechFilter, createLlmWatchdog, createTurnRecovery, stallLine } from './story.ts';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** Must match AGENT_NAME in ../src/token.ts: the token's room configuration dispatches this name. */
const AGENT_NAME = process.env.STORY_AGENT_NAME || 'story-gm';
const APP_URL = process.env.STORY_APP_URL || `http://localhost:${process.env.PORT || 4000}`;

// Voices, all through LiveKit Inference. Cartesia's Robyn is an Australian, mature voice from LiveKit's
// documented list; Deepgram's Aura 2 Draco is a British male voice.
const HESTER_VOICE = 'cartesia/sonic-3:f31cc6a7-c1e8-4764-980c-60a361443dd1';
const BRAM_VOICE = 'deepgram/aura-2:draco';

interface Player {
  identity: string;
  name: string;
  /** A silent test participant ("Add a bot player" on the page): Bram voices its turns. */
  bot: boolean;
}

interface StoryData {
  ctx: JobContext;
  players: Player[];
  /** Scenes started so far, and when the last one started. */
  scene_index: number;
  last_scene_at: number;
  /** Real player inputs in the current scene: a final transcript from the linked player, or Pixel's chat gesture. */
  inputs: number;
  /** A player has spoken (or gestured) since Bram's last tool call: next_scene and end_story need it, so they cannot be chained. */
  input_since_call: boolean;
  /** Bram's last spoken reply, and who had the last turn (an index into players): code picks the next speaker after playout. */
  last_reply: string;
  rotation: number;
  /** Finishes the story once the last speech has played out and a short pause has passed. */
  end_watcher: ReturnType<typeof createEndWatcher> | undefined;
  /** The storyteller agent. */
  bram: Bram | undefined;
  /** Fires if Bram owes a reply and nothing happens for 20 seconds (a hung model request). */
  watchdog: ReturnType<typeof createLlmWatchdog> | undefined;
  ending: boolean;
  /** Everyone is in the ledger: once Hester has finished speaking, she fetches Bram. */
  handoff_pending: boolean;
  pending_bots: string[];
  handed_off: boolean;
  /** The last few exchanges, one line each, saved with the story state. */
  summary: string[];
  replies_in_scene: number;
  described: string[];
  /** Where the party is and what it carries: the code's state of the world. */
  world: World;
  /** The soundtrack that is playing (a place that shares it keeps it going). */
  soundtrack: string | undefined;
  /** Where the party is (for the reply's atmosphere tracking) and turns given to a human since the mute player last had one. */
  location?: PlaceId;
  /** A counter for Pixel's gestures (`story.pixel_seq`), and what Pixel last did, for Bram to weave into his next reply. */
  pixel_seq: number;
  pixel_did: string | undefined;
  /** Travellers who joined after the story began: Bram acknowledges them once. */
  arrivals: string[];
  /** Pixel's gesture cooldown: line to the turn it was last used, and a count of turns given. */
  pixel_cooldown: Map<string, number>;
  turn_no: number;
  /** Who the current reply answers, for the name check. */
  last_speaker_name: string | undefined;
  /** This agent picked up a story another agent left. */
  resumed: boolean;
}

const is_bot = (p: RemoteParticipant) => p.identity.startsWith('bot-');
const is_player = (p: RemoteParticipant) => p.info.kind === ParticipantKind.STANDARD || p.info.kind === undefined;
const humans = (ctx: JobContext) => [...ctx.room.remoteParticipants.values()].filter((p) => is_player(p) && !is_bot(p));

/** Everyone at the door: players and silent bots, with the name the page's token gave them (if any). */
const guests = (ctx: JobContext) =>
  [...ctx.room.remoteParticipants.values()].filter(is_player).map((p) => ({ identity: p.identity, name: p.name, bot: is_bot(p) }));

/**
 * Writes the guests Hester already knows (a typed name on the page, or a bot) into the ledger without asking,
 * and returns who she can greet by name and which humans she still has to ask.
 */
function registerKnown(data: StoryData): { greet: string[]; bots: string[]; unnamed: string[] } {
  const plan = planLedger(guests(data.ctx), new Set(data.players.map((p) => p.identity)));
  const greet: string[] = [];
  const bots: string[] = [];
  for (const g of plan.named) {
    data.players.push({ identity: g.identity, name: g.name, bot: g.bot });
    (g.bot ? bots : greet).push(g.name);
  }
  publishLedger(data);
  return { greet, bots, unnamed: plan.unnamed };
}

/** What Hester should say next, given who she just wrote in and who is still unnamed. */
function nextStep(greet: string[], bots: string[], _unnamed: boolean, _everyone: string): string {
  const greeting = greet.length
    ? `${greet.join(' and ')} told the page ${greet.length === 1 ? 'their name' : 'their names'}, so do not ask: greet ${greet.length === 1 ? 'them' : 'each'} by name in one short, in-character sentence (for example "Ah, ${greet[0]}, we've been expecting you") and they are already in the ledger. `
    : '';
  const mute = bots.length ? `${bots.join(' and ')} cannot speak: greet ${bots.length === 1 ? 'them' : 'each'} warmly too ("and your quiet friend, ${bots[0]}"). ` : '';
  return `${greeting}${mute}Another traveller at the door gave no name and you can hear them now: ask them for their first name.`;
}

const switchListener = (session: voice.AgentSession<StoryData>, identity: string | null) => (session as any)._roomIO?.setParticipant(identity);
const listening_to = (session: voice.AgentSession<StoryData>): string | undefined => (session as any)._roomIO?.linkedParticipant?.identity;

/** What the page shows, published as attributes on the agent's own participant. */
const publish = (ctx: JobContext, attributes: Record<string, string>) => ctx.room.localParticipant?.setAttributes(attributes).catch(() => undefined);

/**
 * Publishes the ledger (identity to name, humans only) as `story.ledger` on the agent's participant, so the page can fill a name field
 * with what Hester wrote, and gives each ledger name to its participant as the display name (people list, transcript, chronicle).
 */
const named_here = new Set<string>();
function publishLedger(data: StoryData) {
  const ledger: Record<string, string> = {};
  for (const p of data.players) if (!p.bot) ledger[p.identity] = p.name;
  publish(data.ctx, { 'story.ledger': JSON.stringify(ledger) });
  for (const [identity, name] of Object.entries(ledger)) {
    const here = data.ctx.room.remoteParticipants.get(identity);
    const key = `${data.ctx.room.name}/${identity}/${name}`;
    if (!here || here.name === name || named_here.has(key)) continue;
    named_here.add(key);
    room_client ??= new RoomServiceClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    room_client.updateParticipant(data.ctx.room.name!, identity, { name }).catch((error: any) => console.log('could not set the display name:', error?.message ?? error));
  }
}

/** Saves the story state in the room's metadata (small JSON), so a new agent can pick the story up. Debounced; failures are only logged. */
let room_client: RoomServiceClient | undefined;
let save_timer: ReturnType<typeof setTimeout> | undefined;
function saveState(data: StoryData, ended = false) {
  if (save_timer) clearTimeout(save_timer);
  save_timer = setTimeout(async () => {
    try {
      room_client ??= new RoomServiceClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
      const state = buildState({ scene_index: data.scene_index, players: data.players, summary: data.summary, ended, world: data.world });
      await room_client.updateRoomMetadata(data.ctx.room.name!, encodeState(state));
      console.log(`story state saved: scene ${state.scene_index}, ${state.summary.length} summary lines`);
    } catch (error: any) {
      console.log('story state not saved:', error?.message ?? error);
    }
  }, 800);
}

/** Hester announces she is fetching Old Bram, in her own voice, then the table passes to him. Code, not a model call. */
async function fetchBram(session: voice.AgentSession<StoryData>, greet: string[], bots: string[]) {
  const data = session.userData;
  if (data.handed_off) return;
  data.handed_off = true;
  data.handoff_pending = false;
  // Anyone who came in while Hester was talking (a bot, or a player who typed a name) is in the story too
  const late = registerKnown(data);
  const line = fetchLine([...greet, ...late.greet], [...bots, ...late.bots], data.players.length % 2);
  await session.say(line, { allowInterruptions: false }).waitForPlayout();
  session.updateAgent(Bram.build(data.players));
}

const itemLabelFor = (raw: string) => { const id = normalizeItem(raw); return id && id !== 'chest' ? itemById(id)?.label : undefined; };

/** The satchel, as item ids on the agent's participant: the page lists it. */
const publishSatchel = (data: StoryData) => publish(data.ctx, { 'story.satchel': satchelAttribute(data.world) });

/** The place the party is in: its id (for Pixel) and name (for the page). The turn is cleared until Bram has spoken. */
const publishPlace = (data: StoryData) => {
  const place = PLACES[data.world.location];
  return publish(data.ctx, { 'story.scene': place.id, 'story.place': place.name, 'story.turn': '', 'story.turn_name': '' });
};

/** Pixel acts: a new sequence number with the gesture to send. Nothing waits for it and it holds no turn: the line goes into the transcript. */
const pixelAct = (data: StoryData, line: string) => {
  data.pixel_seq += 1;
  console.log(`pixel gesture ${data.pixel_seq}: ${line}`);
  return publish(data.ctx, { 'story.pixel_line': line, 'story.pixel_seq': String(data.pixel_seq) });
};

/** The party is at (a new) place: counts, saved story, attributes, and the soundtrack when it differs from the one playing. Returns what to tell Bram about the music. */
async function arrive(data: StoryData): Promise<string | undefined> {
  onSceneStart(data, data.world.location);
  data.last_scene_at = Date.now();
  saveState(data);
  publishPlace(data);
  publishSatchel(data);
  const place = PLACES[data.world.location];
  if (place.soundtrack === data.soundtrack) return undefined;
  data.soundtrack = place.soundtrack;
  try {
    const response = await fetch(`${APP_URL}/api/scene`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: data.ctx.room.name, scene: place.soundtrack }), signal: AbortSignal.timeout(15000) });
    return response.ok ? 'with its soundtrack' : 'without music';
  } catch {
    return 'without music';
  }
}

/**
 * One player input (a spoken answer or Pixel's gesture): a small separate model call reads it into moves, takes, uses and gives, and the
 * code validates and applies them. Returns the note Bram narrates from. Any failure of the call counts as no actions.
 */
async function resolveTurn(data: StoryData, words: string, from_bot = false): Promise<string> {
  let actions = noActions();
  const pixel = data.players.find((p) => p.bot);
  try {
    actions = parseActions(await askShort(actionPrompt(data.world, words, !!pixel), 6000, 160));
  } catch (error: any) {
    console.log(`resolver failed (${error?.message ?? error}): treated as no actions`);
  }
  console.log(`resolver at ${data.world.location}: "${words.trim().slice(0, 80)}" -> ${JSON.stringify(actions)}`);
  // The destination the player names outweighs the model's guess (and words like "door"): the exit that leads there, or a refusal when there is none
  if (!from_bot) {
    const dest = matchDestination(data.world, words);
    if (dest?.exit && actions.move !== dest.exit.id) { console.log(`destination named: ${dest.exit.id} (the resolver said ${actions.move})`); actions.move = dest.exit.id; actions.blocked = null; }
    else if (dest?.destination && !dest.exit) { console.log(`destination named with no way from here: ${dest.destination.name}`); actions.move = null; actions.blocked = dest.destination.name; }
  }
  const to_pixel = !!pixel && !from_bot && (actions.addressed === 'pixel' || addressesPixel(words));
  // "Give Pixel the map": if the resolver missed an obvious give, the words still name the item
  if (to_pixel && !actions.give.length && !actions.take.length && /\b(give|hand|pass|offer|toss|lend)\b/i.test(words)) {
    const named = itemNamed(words);
    if (named) actions.give.push({ item: named, to: 'pixel' });
  }
  const result = applyActions(data.world, actions);
  // A player spoke to Pixel (the resolver says so, or the name is in the words; Pixel's own gestures never count): it answers next turn
  const extra: string[] = [];
  if (to_pixel) {
    const gave = actions.give.find((g) => /pix/i.test(g.to));
    const gave_item = gave ? itemLabelFor(gave.item) : undefined;
    console.log(`pixel addressed: "${words.trim().slice(0, 80)}"${gave_item ? ` (gave ${gave_item})` : ''}`);
    // Pixel answers at once with a gesture that responds to what was asked; it holds no turn and nothing waits for it
    pixelAct(data, respondLine(data.world, gave_item));
    extra.push(`The player spoke to Pixel, the mute traveller. Acknowledge it in a sentence by describing Pixel noticing and reacting (a tilt of the head, a look), and never speak for Pixel or say what Pixel thinks: Pixel answers with a gesture of its own.`);
  }
  if (data.pixel_did) {
    extra.push(`Pixel, the mute traveller, just did this: ${data.pixel_did.replace(/\*/g, '')} Weave it into your reply in one clause if it fits, and never speak for Pixel.`);
    data.pixel_did = undefined;
  }
  if (result.blocked_move) extra.push(`The party's move was blocked. Say plainly, in one sentence, where they can go from here: ${exitsByDestination(data.world)}.`);
  if (data.arrivals.length) {
    extra.push(`${data.arrivals.join(' and ')} just joined the party: acknowledge the new arrival in a few words.`);
    data.arrivals = [];
  }
  if (result.outcomes.length) console.log(`resolved: ${result.outcomes.join(' | ')}`);
  let music: string | undefined;
  if (result.moved) {
    music = await arrive(data);
    // On arriving somewhere new Pixel may react once (when it has a fitting line); Bram weaves it into his next reply
    if (pixel && !to_pixel) {
      const choice = chooseGesture(data.world, data.pixel_cooldown, data.turn_no);
      if (choice.line) { pixelAct(data, choice.line); data.pixel_did = choice.line; } else console.log(`pixel stays quiet on arriving: ${choice.reason}`);
    }
  }
  else if (result.took.length || result.opened || result.lit) {
    publishSatchel(data);
    saveState(data, endTriggered(result));
  }
  if (endTriggered(result)) {
    // The Lantern is lit at the lighthouse: the story ends once Bram's closing has played out
    data.ending = true;
    data.end_watcher?.arm();
    console.log(`the Lantern is lit: ending the story at ${new Date().toISOString()}`);
    return closingNote(result.outcomes);
  }
  return placeNote(data.world, { full: result.moved, described: data.described, replies: data.replies_in_scene, outcomes: result.outcomes, music, arriving: result.moved, extra });
}

class Hester extends voice.Agent<StoryData> {
  /**
   * Opens the evening. Called once the room is connected and the first guest is at the door, because
   * who is there, and whether they gave a name, decides what Hester says first.
   */
  async open(session: voice.AgentSession<StoryData>) {
    const data = session.userData;
    const { greet, bots, unnamed } = registerKnown(data);
    const first_human = unnamed[0] ?? data.players.find((p) => !p.bot)?.identity;
    if (first_human) switchListener(session, first_human);
    // Everyone at the door already has a name (typed on the page, or a bot): greet them and fetch Bram, with no model call
    if (!unnamed.length) return fetchBram(session, greet, bots);
    const intro = 'You are standing at the door of the inn, shaking the rain off your apron as travellers come in. ';
    const known = greet.length || bots.length;
    session.generateReply({
      instructions: known
        ? `${intro}${nextStep(greet, bots, true, '')}`
        : `${intro}Greet them in one short sentence, say it is a wild night and the ledger is open, and ask the traveller you can hear for their first name.`,
    });
  }

  static build() {
    return new Hester({
      instructions: `You are Hester Pennywhistle, innkeeper of the Drowned Bell, a crooked old inn on the shore of the Hollow Mere. You are brisk, warm and a little nosy, with a dry sense of humour, and you call everyone "love" or "dear". You are a fictional character in a spoken adventure. ${BREVITY} Speak plainly: at most one "love" or "dear" per reply, and no riddles.
Travellers who come in out of the storm must sign your ledger. A traveller who already gave their name at the door is written in for you: never ask for it and never call write_in_ledger for them. You can hear only one traveller at a time: ask the one you can hear for their first name. When you hear it, call write_in_ledger with it as the whole of your reply, with no words before it, then greet them by name in one short sentence once it returns. Never write or say a tool name or function call. Never mention fetching Old Bram: that is done for you.`,
      tts: new inference.TTS({ model: HESTER_VOICE as any }),
      // A player talking over her must not cut her off
      allowInterruptions: false,
      tools: {
        write_in_ledger: llm.tool({
          description: 'Write the first name of the traveller you can hear in the inn ledger.',
          parameters: z.object({ name: z.string().describe('The traveller\'s first name') }),
          execute: async ({ name }, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            const { players } = data;
            const session = ctx.session as voice.AgentSession<StoryData>;
            // Only a plausible first name goes in the ledger: not "I", "the" or a sentence
            if (!/^\p{L}[\p{L}'-]{1,19}$/u.test(name.trim()) || ['the', 'my', 'me', 'and', 'light', 'home', 'way'].includes(name.trim().toLowerCase())) return `That did not sound like a first name. Ask the traveller again, in your own words, for just their first name.`;
            const identity = listening_to(session);
            if (identity && !players.some((p) => p.identity === identity)) { players.push({ identity, name, bot: false }); publishLedger(data); }
            // Anyone who came in with a name on the page, and any bot, goes in the ledger without being asked
            const { greet, bots, unnamed } = registerKnown(data);
            if (unnamed.length) {
              switchListener(session, unnamed[0]);
              return `${name} is in the ledger. ${nextStep(greet, bots, true, '')}`;
            }
            const first = players.find((p) => !p.bot);
            if (first) switchListener(session, first.identity);
            // Everyone is in: once this reply has been spoken, the code (not the model) fetches Old Bram
            data.handoff_pending = true;
            data.pending_bots = bots;
            return `${name} is in the ledger. Greet ${name} by name in one short sentence. Say nothing about fetching anyone: that is done for you.`;
          },
        }),
      },
    });
  }
}

class Bram extends voice.Agent<StoryData> {
  /** Set when this Bram is picking up a story another agent left: he recaps instead of starting the first scene. */
  resume_state: StoryState | undefined;

  async onEnter() {
    publish(this.session.userData.ctx, { 'story.character': 'Old Bram Tallow, storyteller' });
    this.session.userData.bram = this;
    if (this.resume_state) {
      console.log(`resuming the story at scene ${this.resume_state.scene_index} with a recap`);
      this.session.generateReply({ instructions: recapInstructions(this.resume_state, this.session.userData.players), toolChoice: 'none' });
      return;
    }
    // The story starts: the party is in its first place, and the code tells Bram what is there
    const data = this.session.userData;
    arrive(data).then((music) => {
      const note = placeNote(data.world, { full: true, music, arriving: true });
      this.session.generateReply({
        instructions: `You have just come in from the fire at Hester's call. Introduce yourself in one plain sentence as Old Bram, retired keeper of the Hollow Light, greet the travellers by name once, state the goal plainly in one sentence (my lighthouse went dark in the storm, and only the Lantern of Hollow Mere can relight it), then describe where the party is. Do not call any tool. ${note}`,
        toolChoice: 'none',
      });
    });
  }

  /**
   * Runs when a player has finished speaking, before Bram replies. The input is counted here (a real player input), and a system
   * note says where the scene stands, so the reply follows the story's pacing.
   */
  async onUserTurnCompleted(chat_ctx: llm.ChatContext, new_message: llm.ChatMessage): Promise<void> {
    const data = this.session.userData;
    if (!data.handed_off || data.ending || !new_message.textContent?.trim()) return;
    onPlayerInput(data);
    data.watchdog?.arm();
    console.log(`player input counted: inputs=${data.inputs}`);
    data.summary = addSummaryLine(data.summary, data.players.find((p) => p.identity === listening_to(this.session))?.name ?? 'Player', new_message.textContent);
    saveState(data);
    // A small separate model call reads the words into actions; the code applies them and tells Bram what happened
    const words = new_message.textContent;
    const speaker = data.players.find((p) => p.identity === listening_to(this.session));
    // A player who gives or corrects their name ("I'm Snaggle"): the ledger follows, and Bram acknowledges it
    let name_note = '';
    const given = parseNameCorrection(words);
    if (speaker && !speaker.bot && given && given.toLowerCase() !== speaker.name.toLowerCase()) {
      console.log(`name corrected: ${speaker.name} -> ${given}`);
      speaker.name = given;
      publishLedger(data);
      saveState(data);
      name_note = ` The player has just told you their name is ${given}: acknowledge it in a few words and carry on.`;
    }
    data.last_speaker_name = speaker?.name;
    const note = await resolveTurn(data, words);
    chat_ctx.addMessage({ role: 'system', content: `${note}${name_note}` });
  }

  static build(players: Player[], resume?: StoryState) {
    const bram = Bram.make(players);
    bram.resume_state = resume;
    return bram;
  }

  private static make(players: Player[]) {
    return new Bram({
      instructions: bramInstructions(players),
      tts: new inference.TTS({ model: BRAM_VOICE as any }),
      allowInterruptions: false,
    });
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession<StoryData>({
      stt: new inference.STT({ model: 'deepgram/nova-3', language: 'en' }),
      llm: makeLlm(),
      // Bram has two tools and a model that chains tool calls gets cut off: allow one step, and filter tool names from speech as a backstop
      maxToolSteps: 2,
      turnHandling: {
        // The local turn-detector model stalled under load (a final transcript, then silence), and our scene note changes the chat
        // context every turn so a preemptive reply is always thrown away. End turns on VAD silence (at most 3 s) and generate after the turn.
        turnDetection: 'vad',
        endpointing: { minDelay: 700, maxDelay: 3000 },
        preemptiveGeneration: { enabled: false },
      },
      ttsTextTransforms: ['filter_markdown', 'filter_emoji', speechFilter((what) => console.log(`speech filter removed a tool name from: ${what.slice(0, 120)}`))],
      userData: { ctx, players: [], scene_index: 0, last_scene_at: 0, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, end_watcher: undefined, bram: undefined, watchdog: undefined, ending: false, handoff_pending: false, pending_bots: [], handed_off: false, summary: [], resumed: false, replies_in_scene: 0, described: [], world: worldAt(process.env.STORY_START, process.env.STORY_ITEMS), soundtrack: undefined, pixel_cooldown: new Map(), turn_no: 0, pixel_seq: 0, pixel_did: undefined, arrivals: [], last_speaker_name: undefined },
    });
    const job_ctx = ctx;
    session.userData.end_watcher = createEndWatcher(() => {
      // The closing has played out and the pause has passed: mark the story ended, stop the soundtrack, leave
      console.log(`story ended at ${new Date().toISOString()}: closing played out, pause done`);
      publish(job_ctx, { 'story.state': 'ended', 'story.turn': '', 'story.turn_name': '' });
      fetch(`${APP_URL}/api/scene/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: job_ctx.room.name }), signal: AbortSignal.timeout(10000) })
        .catch(() => undefined)
        .finally(() => setTimeout(() => job_ctx.shutdown('the story is over'), 3000));
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => session.userData.end_watcher?.onAgentState(e.oldState, e.newState));
    // The in-character "say that again" line, with the turn handed back to the player
    const say_again = (why: string) => {
      const data = session.userData;
      if (data.ending) return;
      const player = data.players[data.rotation] ?? data.players.find((p) => !p.bot);
      console.log(`watchdog (${why}): giving the turn back to ${player?.name ?? 'the player'} with the say-that-again line`);
      session.interrupt();
      session.say(stallLine(player?.name), { allowInterruptions: false });
      if (player) {
        switchListener(session, player.identity);
        publish(data.ctx, { 'story.turn': player.identity, 'story.turn_name': player.name, 'story.turn_seq': String(data.inputs + data.scene_index * 100 + data.rotation + 50) });
      }
    };
    // If a model request hangs after the turn ended, Bram says one short line and the turn goes back to the player
    session.userData.watchdog = createLlmWatchdog(() => say_again('no reply 20 s after the turn ended'));
    // If a final transcript arrives and the turn never ends (the stall seen under load), force the turn to end after 15 s; if that
    // produces nothing either, say the line
    const recovery = createTurnRecovery({
      commit: () => { console.log('watchdog (turn never ended 15 s after a final transcript): committing the user turn'); session.commitUserTurn(); },
      say_again: () => say_again('committing the turn did not start a reply'),
    });
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (e: any) => { if (e.isFinal && String(e.transcript || '').trim() && !session.userData.ending) recovery.onFinalTranscript(); });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => { if (e.newState === 'thinking' || e.newState === 'speaking') recovery.onProgress(); });
    // Progress: Bram started speaking, so the request is not hung. A tool that ran owes a follow-up reply, so the watchdog starts again
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => { if (e.newState === 'speaking') session.userData.watchdog?.progress(); });
    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, () => session.userData.watchdog?.arm());
    // Once Hester has finished the sentence that follows the last name in the ledger, she fetches Old Bram
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => {
      const data = session.userData;
      if (shouldFetchBram(e.oldState, e.newState, data.handoff_pending, data.handed_off)) fetchBram(session, [], data.pending_bots).catch((error) => console.log('handoff error:', error));
    });
    session.on(voice.AgentSessionEventTypes.Error, (e: any) => console.log('agent error:', e.error?.message ?? e));
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (e: any) => {
      const item = e.item;
      if (!item?.role || !item.textContent) return;
      console.log(`${item.role}: ${item.textContent}`);
      const data = session.userData;
      if (!data.handed_off || data.ending) return;
      // Player inputs are counted in Bram's onUserTurnCompleted. Here only Bram's own reply is kept, to see who he named.
      if (item.role === 'assistant') {
        onBramReply(data, item.textContent);
        if (usesName(item.textContent, data.last_speaker_name)) console.log(`name check: the reply used the speaker's name "${data.last_speaker_name}" (${data.players.filter((p) => !p.bot).length} human player(s))`);
        data.summary = addSummaryLine(data.summary, 'Bram', item.textContent);
        saveState(data);
      }
    });
    // When Bram has finished speaking, code (not a model tool) gives the next turn: the player he named, or the next in rotation
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => {
      const data = session.userData;
      if (e.oldState !== 'speaking' || e.newState !== 'listening' || !data.handed_off || data.ending || !data.bram || data.scene_index === 0) return;
      // Humans only: Pixel never holds the turn
      const next = onPlayout(data, data.players);
      if (!next) return;
      data.turn_no += 1;
      const index = data.rotation;
      // Text input is accepted only from the participant being listened to, so link whoever's turn it is
      switchListener(session, next.identity);
      publish(data.ctx, { 'story.turn': next.identity, 'story.turn_name': next.name, 'story.turn_seq': String(data.turn_no * 1000 + data.inputs * 10 + index) });
      console.log(`turn given to ${next.name} after playout (inputs=${data.inputs})`);
    });

    // A player who leaves must not end the story for the others: listen to someone who is still here
    ctx.room.on('participantDisconnected', (p: RemoteParticipant) => {
      if (listening_to(session) !== p.identity) return;
      const next = humans(ctx)[0];
      switchListener(session, next ? next.identity : null);
    });

    // Hard rule: nothing waits on Pixel. If the listener is ever a bot for more than about 5 s, it goes back to a human and the skip is logged
    let bot_since = 0;
    setInterval(() => {
      const who = listening_to(session);
      if (!who || !who.startsWith('bot-')) { bot_since = 0; return; }
      bot_since ||= Date.now();
      if (Date.now() - bot_since < 5000) return;
      const human = session.userData.players.find((p) => !p.bot) ?? humans(ctx).map((p) => ({ identity: p.identity, name: p.name }))[0];
      console.log(`pixel held the listener for 5 s: skipping to ${human?.name ?? 'the next human'}`);
      if (human) switchListener(session, human.identity);
      bot_since = 0;
    }, 1000).unref();

    // A traveller who joins after the story began (Pixel added mid-story, or a player with a name) joins the party: it was never in the
    // ledger, so without this it would never get a turn. Bram's roster is updated and he acknowledges the arrival once.
    ctx.room.on('participantConnected', (p: RemoteParticipant) => {
      const data = session.userData;
      if (!data.handed_off || !is_player(p) || data.players.some((x) => x.identity === p.identity)) return;
      const bot = is_bot(p);
      const name = p.name && p.name !== p.identity ? p.name : bot ? botName(p.identity) : '';
      if (!name) return;
      data.players.push({ identity: p.identity, name, bot });
      data.arrivals.push(bot ? `${name}, a mute traveller,` : name);
      console.log(`${name} joined the party after the story began`);
      publishLedger(data);
      saveState(data);
      data.bram?.updateInstructions(bramInstructions(data.players)).catch(() => undefined);
    });

    const hester = Hester.build();
    await session.start({
      agent: hester,
      room: ctx.room,
      // No session audio or trace recording: the recorder (ffmpeg, plus whole-session buffers) was holding most of the job's memory
      record: false,
      inputOptions: {
        closeOnDisconnect: false,
        // Chat text from the player being listened to: a mute player's gesture. It is a real player input, and Bram reacts to it as to a spoken answer.
        textInputCallback: (sess, ev) => {
          const data = session.userData;
          if (data.handed_off && !data.ending) {
            onPlayerInput(data);
            data.watchdog?.arm();
            console.log(`player gesture counted: inputs=${data.inputs}`);
            data.summary = addSummaryLine(data.summary, data.players.find((p) => p.identity === listening_to(session))?.name ?? 'Player', ev.text);
            saveState(data);
          }
          sess.interrupt();
          // A gesture is read into actions like a spoken answer (Pixel can point at an exit or an item), then Bram narrates from the note
          const reply = (instructions: string | undefined) => sess.generateReply({ userInput: ev.text, instructions });
          if (data.handed_off && !data.ending) resolveTurn(data, ev.text, (listening_to(session) ?? '').startsWith('bot-')).then(reply, () => reply(undefined));
          else reply(undefined);
        },
      },
    });
    await ctx.connect();
    // Two story agents in one room would run two stories at once: if another is already here, this one leaves
    if ([...ctx.room.remoteParticipants.values()].some((p) => p.info.kind === ParticipantKind.AGENT)) {
      console.log('another story agent is already in this room: leaving');
      ctx.shutdown('duplicate story agent');
      return;
    }
    // onEnter ran before the room connected, so publish Hester's attributes again now
    await publish(ctx, { 'story.character': 'Hester Pennywhistle, innkeeper', 'story.state': 'playing', 'story.turn': '', 'story.turn_name': '' });
    publishSatchel(session.userData);
    // Open once the first guest is at the door: whether they gave a name decides Hester's first words
    await ctx.waitForParticipant();
    // A story another agent left (a dead job that LiveKit re-dispatched, or "Continue the story"): skip Hester and pick it up
    const saved = decodeState(ctx.room.metadata);
    if (shouldResume(saved)) {
      const data = session.userData;
      data.players = resumePlayers(saved.players, guests(ctx).map((g) => ({ identity: g.identity, name: g.name || '', bot: g.bot })));
      data.scene_index = saved.scene_index;
      data.last_scene_at = Date.now();
      data.summary = saved.summary;
      data.handed_off = true;
      data.resumed = true;
      data.world = saved.world;
      data.soundtrack = PLACES[saved.world.location].soundtrack;
      data.replies_in_scene = 0;
      data.described = [];
      data.location = saved.world.location;
      const first = data.players.find((p) => !p.bot);
      if (first) switchListener(session, first.identity);
      publish(ctx, { 'story.scene': saved.world.location, 'story.place': PLACES[saved.world.location].name });
      console.log(`story state found in the room: resuming at scene ${saved.scene_index}`);
      publishLedger(data);
      publishSatchel(data);
      session.updateAgent(Bram.build(data.players, saved));
      return;
    }
    await hester.open(session);
  },
});

console.log(describeLlm());
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
