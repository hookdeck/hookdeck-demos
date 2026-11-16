/**
 * The two characters of story night: Hester Pennywhistle, the innkeeper of the Drowned Bell, who greets
 * travellers at the door and writes each name in her ledger, and Old Bram Tallow, a retired lighthouse
 * keeper who tells the adventure. Both are fictional. They are one agent participant in the room, handed
 * off with `llm.handoff` when Hester says she will fetch Bram. At each new scene Bram calls `next_scene`,
 * which asks the demo app to pull that scene's soundtrack into the room with LiveKit's Ingress API.
 *
 * Speech-to-text, the language model and text-to-speech all run on LiveKit Inference, so the only
 * credentials are the LiveKit project's API key and secret. Run it with `npm run agent`.
 *
 * The agent publishes what the page needs as participant attributes on its own participant:
 * `story.character` (who is speaking), `story.turn` and `story.turn_name` (whose turn it is),
 * `story.scene` and `story.state` (`playing` or `ended`).
 */
import { type JobContext, ServerOptions, cli, defineAgent, inference, llm, voice } from '@livekit/agents';
import { ParticipantKind, type RemoteParticipant } from '@livekit/rtc-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { describeLlm, makeLlm } from './llm.ts';
import { fetchLine, planLedger, shouldFetchBram } from './names.ts';
import { SCENES, canStartNext, createEndWatcher, guidanceFor, nextSceneIndex } from './story.ts';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** Must match AGENT_NAME in ../src/token.ts: the token's room configuration dispatches this name. */
const AGENT_NAME = 'story-gm';
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
  /** Scenes started so far, and when the last one started (a repeated call within seconds is ignored). */
  scene_index: number;
  last_scene_at: number;
  /** Turns handed over so far, to vary how Bram hands them over. */
  turns: number;
  /** Players who have had a turn in the current scene (to rotate fairly), and how many exchanges the scene has had. */
  turn_taken: Set<string>;
  exchanges: number;
  /** Test only (STORY_SHORT=1): jump to the finale after the first scene. */
  short_mode: boolean;
  /** Finishes the story once the last speech has played out and a short pause has passed. */
  end_watcher: ReturnType<typeof createEndWatcher> | undefined;
  /** Everyone is in the ledger: once Hester has finished speaking, she fetches Bram. */
  handoff_pending: boolean;
  pending_bots: string[];
  handed_off: boolean;
  /** A mute player's gesture (a chat message) that `give_turn` is waiting for, by the player's identity. */
  gesture_waiters: Map<string, (text: string) => void>;
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

/** How Bram hands a turn over. The tool rotates through these so he does not end every reply the same way. */
const HANDOVERS = [
  'ask one open question about their next move, in your own fresh words (never "what do you do")',
  'offer two concrete choices and ask which they take',
  'describe one vivid detail near them and simply wait, with no question at all, letting the beat land',
  'invite a line of dialogue: say what someone in the scene is waiting to hear from them',
  'ask what their character notices or feels in this moment',
  'speak to them by name with a short challenge or dare, not a question',
];

const BREVITY = 'You speak aloud, so keep to two short sentences at a time, with no lists, no stage directions and no emoji.';

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
            if (identity && !players.some((p) => p.identity === identity)) players.push({ identity, name, bot: false });
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
  async onEnter() {
    publish(this.session.userData.ctx, { 'story.character': 'Old Bram Tallow, storyteller' });
    this.session.generateReply({
      instructions: 'You have just come in from the fire at Hester\'s call. Introduce yourself in one plain sentence as Old Bram, retired keeper of the Hollow Light, and greet the travellers by name. Then call next_scene, describe the first scene in two short plain sentences, and call give_turn for the first player.',
    });
  }

  static build(players: Player[]) {
    const roster = players.map((p) => (p.bot ? `${p.name} (a mute traveller who cannot speak and answers with gestures, which come back to you as short text lines like "*Pixel taps the map.*" when you give it the turn)` : p.name)).join(', ');
    return new Bram({
      instructions: `You are Old Bram Tallow, a retired lighthouse keeper who tells stories at the Drowned Bell: warm, gravelly and kind. You are a fictional character telling "The Lantern of Hollow Mere" to these travellers: ${roster}. ${BREVITY}
Speak plainly. Describe in simple words what the players see, hear and can do. Use at most one sea-worn phrase per reply, and none is fine. No riddles, no vague hints and no spooky foreshadowing unless a player asks for a clue. Every reply makes it obvious what just happened and what the players can do next. Every choice you offer names concrete options a player can act on, such as "the north door or the rope bridge".
Call tools silently: when you need a tool, call it first in your reply, before you speak, and never write or say a tool name or function call in your speech.
The story has four scenes, and the players decide when each one ends. Call next_scene to start a scene: it plays the soundtrack and tells you the place, what is there and the ways onward. Describe the scene in two short plain sentences that mention one or two of those things. Then call give_turn for a player and rotate between the players. give_turn tells you how to hand that turn over; follow it, once per reply, and never ask two questions in one reply. React to each answer in one or two plain sentences that use what the player said.
Aim for two or three exchanges per scene. A scene ends when the players' choices take them somewhere new, or when you offer a clear choice to move on that names concrete options and they take it: then call next_scene. Never move on unprompted. A mute traveller such as Pixel never decides: its gestures can hint at the way forward, but only a spoken choice from a player moves the group on. When you give a mute traveller the turn, the gesture comes back as the tool's result: weave it into your reaction.
The finale is the last scene. Give each player a turn there, then call end_story, and only after the tool answers, speak your closing: at most three sentences that say what the players did and end the story. Do not say anything after the closing.`,
      tts: new inference.TTS({ model: BRAM_VOICE as any }),
      allowInterruptions: false,
      tools: {
        next_scene: llm.tool({
          description: 'Start the next scene and its soundtrack. Returns what the scene is.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            // The model sometimes repeats a call: ignore a second one within 20 seconds
            if (Date.now() - data.last_scene_at < 20000) return `Scene ${data.scene_index} is already under way: describe it in two short plain sentences.`;
            if (data.scene_index >= SCENES.length) return 'The story is over: call end_story and speak your closing.';
            if (data.scene_index > 0 && !canStartNext(data.exchanges, data.short_mode)) return `The players have only just begun this scene. Give them another turn first, and offer the way onward only after at least two exchanges.`;
            const index = nextSceneIndex(data.scene_index, data.short_mode);
            data.scene_index = index + 1;
            const { scene, place, sights, onward } = SCENES[index];
            data.last_scene_at = Date.now();
            data.turn_taken.clear();
            data.exchanges = 0;
            publish(data.ctx, { 'story.scene': scene, 'story.turn': '', 'story.turn_name': '' });
            let music = 'with its soundtrack';
            try {
              const response = await fetch(`${APP_URL}/api/scene`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ room: data.ctx.room.name, scene }),
                signal: AbortSignal.timeout(15000),
              });
              if (!response.ok) music = 'without music';
            } catch {
              music = 'without music';
            }
            const finale = index === SCENES.length - 1;
            return `Scene ${index + 1} of ${SCENES.length} has started ${music}. Place: ${place}. What is here: ${sights}. ${finale ? 'This is the finale: give each player a turn, then call end_story and speak your closing.' : `Ways onward, to offer later as one clear choice: ${onward}.`} Describe it in two short plain sentences that mention one or two of these things, then call give_turn for a player.`;
          },
        }),
        give_turn: llm.tool({
          description: 'Hand the turn to one player so you can hear them. Returns how to hand it over.',
          parameters: z.object({ player: z.string().describe('The player\'s name') }),
          execute: async ({ player }, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            const match = data.players.find((p) => p.name.toLowerCase() === player.toLowerCase());
            if (!match) return `No player called ${player}.`;
            const guidance = guidanceFor(data.exchanges);
            const finale = data.scene_index >= SCENES.length;
            const scene = SCENES[Math.min(data.scene_index, SCENES.length) - 1];
            if (guidance === 'nudge' && !finale) return `The scene has gone on long enough. Do not give another open turn: say in one plain sentence that it is time to move on, offer the way onward as one clear choice (${scene?.onward}), and when a player picks, call next_scene.`;
            if (guidance === 'nudge' && finale) return 'The finale has had enough turns. Call end_story now, then speak your closing.';
            data.exchanges += 1;
            data.turn_taken.add(match.identity);
            const waiting = data.players.filter((p) => !data.turn_taken.has(p.identity)).map((p) => p.name);
            const how = HANDOVERS[data.turns++ % HANDOVERS.length];
            const choice = guidance === 'offer_choice' && !finale && scene ? ` The scene has had enough exploring, so make this hand-over the choice to move on: name the concrete options (${scene.onward}) and ask which the group takes. Only call next_scene once a player has chosen.` : '';
            const next = waiting.length ? ` Players who have not had a turn in this scene yet: ${waiting.join(', ')}.` : '';
            publish(data.ctx, { 'story.turn': match.identity, 'story.turn_name': match.name, 'story.turn_seq': String(data.turns) });
            if (match.bot) {
              // A mute player answers with a gesture, sent as a chat message. Wait for it here, so it comes back as this
              // tool's result and Bram weaves it into his reaction in the same reply: no extra model call.
              const gesture = await new Promise<string | undefined>((resolve) => {
                data.gesture_waiters.set(match.identity, resolve);
                setTimeout(() => { if (data.gesture_waiters.get(match.identity) === resolve) { data.gesture_waiters.delete(match.identity); resolve(undefined); } }, 12000);
                // Text input is accepted only from the participant being listened to
                switchListener(ctx.session as voice.AgentSession<StoryData>, match.identity);
              });
              return gesture
                ? `${match.name} is mute and answers with a gesture: ${gesture} React to it in one or two plain sentences, then give the turn to a player who can speak. ${match.name}'s gesture can hint at the way forward but never decides it. Do not ask ${match.name} anything.${next}`
                : `${match.name} is mute and does nothing you can see this turn: say in one plain sentence what ${match.name} is doing, then give the turn to a player who can speak.${next}`;
            }
            switchListener(ctx.session as voice.AgentSession<StoryData>, match.identity);
            return `You can hear ${match.name} now. Hand the turn to ${match.name}: ${how}. Once, in this reply only.${choice}${next}`;
          },
        }),
        end_story: llm.tool({
          description: 'End the story. Call it before your closing; it tells you when to speak the closing.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            // The story is marked ended, and the agent leaves, only after the closing has played out in full and a short pause
            ctx.userData.end_watcher?.arm();
            console.log(`end_story called at ${new Date().toISOString()}`);
            return 'Speak your closing now: at most three plain sentences that say what the players did and end the story. Do not call any tool afterwards and do not say anything after it.';
          },
        }),
      },
    });
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession<StoryData>({
      stt: new inference.STT({ model: 'deepgram/nova-3', language: 'en' }),
      llm: makeLlm(),
      userData: { ctx, players: [], scene_index: 0, last_scene_at: 0, turns: 0, turn_taken: new Set(), exchanges: 0, short_mode: process.env.STORY_SHORT === '1', end_watcher: undefined, handoff_pending: false, pending_bots: [], handed_off: false, gesture_waiters: new Map() },
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
    // Once Hester has finished the sentence that follows the last name in the ledger, she fetches Old Bram
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => {
      const data = session.userData;
      if (shouldFetchBram(e.oldState, e.newState, data.handoff_pending, data.handed_off)) fetchBram(session, [], data.pending_bots).catch((error) => console.log('handoff error:', error));
    });
    session.on(voice.AgentSessionEventTypes.Error, (e: any) => console.log('agent error:', e.error?.message ?? e));
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (e: any) => {
      const item = e.item;
      if (item?.role && item.textContent) console.log(`${item.role}: ${item.textContent}`);
    });

    // A player who leaves must not end the story for the others: listen to someone who is still here
    ctx.room.on('participantDisconnected', (p: RemoteParticipant) => {
      if (listening_to(session) !== p.identity) return;
      const next = humans(ctx)[0];
      switchListener(session, next ? next.identity : null);
    });

    const hester = Hester.build();
    await session.start({
      agent: hester,
      room: ctx.room,
      inputOptions: {
        closeOnDisconnect: false,
        // Chat text from the player being listened to. A mute player's gesture goes to the give_turn call that is
        // waiting for it; anything else is a typed message and gets a reply, as usual.
        textInputCallback: (sess, ev) => {
          const waiting = session.userData.gesture_waiters.get(ev.participantIdentity ?? '');
          if (waiting) {
            session.userData.gesture_waiters.delete(ev.participantIdentity ?? '');
            waiting(ev.text);
            return;
          }
          sess.interrupt();
          sess.generateReply({ userInput: ev.text });
        },
      },
    });
    await ctx.connect();
    // onEnter ran before the room connected, so publish Hester's attributes again now
    await publish(ctx, { 'story.character': 'Hester Pennywhistle, innkeeper', 'story.state': 'playing', 'story.turn': '', 'story.turn_name': '' });
    // Open once the first guest is at the door: whether they gave a name decides Hester's first words
    await ctx.waitForParticipant();
    await hester.open(session);
  },
});

console.log(describeLlm());
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
