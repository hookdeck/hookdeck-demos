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
import { SCENES, createEndWatcher, guidanceFor, moveOnVerdict, nextSceneIndex, onBramReply, onPlayerInput, onPlayout, onSceneStart, speechFilter } from './story.ts';

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
  /** Test only (STORY_SHORT=1): jump to the finale after the first scene. */
  short_mode: boolean;
  /** Finishes the story once the last speech has played out and a short pause has passed. */
  end_watcher: ReturnType<typeof createEndWatcher> | undefined;
  /** The storyteller agent, so its instructions can follow the scene and how long it has run. */
  bram: Bram | undefined;
  ending: boolean;
  /** Everyone is in the ledger: once Hester has finished speaking, she fetches Bram. */
  handoff_pending: boolean;
  pending_bots: string[];
  handed_off: boolean;
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

/** What is true of the scene right now, given to Bram as a system message before each reply to a player. */
function sceneHint(scene_index: number, inputs: number, ending: boolean): string {
  const scene = scene_index > 0 ? SCENES[Math.min(scene_index, SCENES.length) - 1] : undefined;
  const finale = scene_index >= SCENES.length;
  const guidance = guidanceFor(inputs);
  const where = scene
    ? `Current scene (${scene_index} of ${SCENES.length}): ${scene.place}. What is here: ${scene.sights}.${finale ? '' : ` Ways onward: ${scene.onward}.`}`
    : 'The story has not started: call next_scene.';
  const phase = ending
    ? 'The story is ending: speak your closing only.'
    : finale
      ? inputs >= 2
        ? 'This is the finale and the players have acted. Call end_story, and after it answers speak your closing.'
        : 'This is the finale: let the players act, then close. Do not call end_story yet.'
      : guidance === 'open'
        ? `The players have made ${inputs} move${inputs === 1 ? '' : 's'} in this scene. Do not offer to move on yet and do not call next_scene: react to what they did and let them explore.`
        : guidance === 'offer_choice'
          ? `The players have explored enough (${inputs} moves). In THIS reply, offer one clear choice to move on that names the concrete options (${scene?.onward}). Call next_scene only in a later reply, when a player has chosen to move on.`
          : `The scene has gone on long enough (${inputs} moves). Say in one plain sentence that it is time to move on and offer the choice (${scene?.onward}); when a player picks, call next_scene.`;
  return `${where} ${phase}`;
}

/** Bram's standing instructions: who he is, how he speaks, how he ends a reply. */
function bramInstructions(players: Player[]): string {
  const roster = players.map((p) => (p.bot ? `${p.name} (a mute traveller who cannot speak: what ${p.name} does arrives as a message in asterisks, like "*${p.name} taps the map.*")` : p.name)).join(', ');
  const mute = players.some((p) => p.bot) ? ' A mute traveller never decides anything: its gestures can hint at the way forward, but only a spoken choice from a player moves the group on.' : '';
  return `You are Old Bram Tallow, a retired lighthouse keeper who tells stories at the Drowned Bell: warm, gravelly and kind. You are a fictional character telling "The Lantern of Hollow Mere" to these travellers and only these: ${roster}. ${BREVITY}
Speak plainly. Describe in simple words what the players see, hear and can do. Use at most one sea-worn phrase per reply, and none is fine. No riddles, no vague hints and no spooky foreshadowing unless a player asks for a clue. Every reply makes it obvious what just happened and what the players can do next. Every choice you offer names concrete options a player can act on, such as "the north door or the rope bridge".
End every reply by naming the one player who answers next, then stop and wait: you never answer for the players and never continue until a player has spoken. Rotate between the players.${mute} Never ask two questions in one reply, and never use the same words to hand a turn over twice in a row.
Each reply to a player is preceded by a system note about the current scene: follow it. You have only two tools, next_scene and end_story. Call a tool only when the note says to, and never write or say a tool name or function call in your speech.`;
}

class Bram extends voice.Agent<StoryData> {
  async onEnter() {
    publish(this.session.userData.ctx, { 'story.character': 'Old Bram Tallow, storyteller' });
    this.session.userData.bram = this;
    this.session.generateReply({
      instructions: 'You have just come in from the fire at Hester\'s call. Call next_scene now, before you say anything. When it answers, introduce yourself in one plain sentence as Old Bram, retired keeper of the Hollow Light, greet the travellers by name, then describe the first scene as the tool says and end by naming the player who answers first.',
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
    console.log(`player input counted: inputs=${data.inputs}`);
    chat_ctx.addMessage({ role: 'system', content: sceneHint(data.scene_index, data.inputs, data.ending) });
  }

  static build(players: Player[]) {
    return new Bram({
      instructions: bramInstructions(players),
      tts: new inference.TTS({ model: BRAM_VOICE as any }),
      allowInterruptions: false,
      tools: {
        next_scene: llm.tool({
          description: 'Start the next scene and its soundtrack. Call it only in the reply that answers a player who chose to move on.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            // Not chained after another call, and not before the scene has had its real player inputs. A refusal returns nothing, so Bram does not speak again.
            const verdict = data.scene_index === 0 ? 'ok' : moveOnVerdict(data.inputs, data.input_since_call, data.short_mode);
            if (verdict !== 'ok' || data.scene_index >= SCENES.length) {
              console.log(`next_scene refused (${verdict === 'ok' ? 'story over' : verdict}), inputs=${data.inputs}`);
              // Nothing is returned, so the model gets no follow-up of its own. The player still gets an answer: one reply, with no tools.
              ctx.session.generateReply({ instructions: `${sceneHint(data.scene_index, data.inputs, data.ending)} React to what the player just said in one or two plain sentences that keep the scene going, and end by naming the player who answers next. Do not call a tool.`, toolChoice: 'none' });
              return undefined;
            }
            const index = nextSceneIndex(data.scene_index, data.short_mode);
            onSceneStart(data, index);
            const { scene, place, sights, onward } = SCENES[index];
            data.last_scene_at = Date.now();
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
            console.log(`next_scene accepted: scene ${index + 1} ${scene}`);
            return `Scene ${index + 1} of ${SCENES.length} has started ${music}. Place: ${place}. What is here: ${sights}. ${finale ? 'This is the finale.' : `Ways onward, to offer later as one clear choice: ${onward}.`} Describe it in two short plain sentences that mention one or two of these things, then end by naming the player who answers first.`;
          },
        }),
        end_story: llm.tool({
          description: 'End the story. Call it before your closing; it tells you when to speak the closing.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            const verdict = moveOnVerdict(data.inputs, data.input_since_call, data.short_mode);
            if (data.scene_index < SCENES.length || verdict !== 'ok') {
              console.log(`end_story refused (${verdict}), scene ${data.scene_index}, inputs=${data.inputs}`);
              ctx.session.generateReply({ instructions: `${sceneHint(data.scene_index, data.inputs, data.ending)} React to what the player just said in one or two plain sentences that keep the scene going, and end by naming the player who answers next. Do not call a tool.`, toolChoice: 'none' });
              return undefined;
            }
            data.ending = true;
            data.input_since_call = false;
            // The story is marked ended, and the agent leaves, only after the closing has played out in full and a short pause
            data.end_watcher?.arm();
            console.log(`end_story accepted at ${new Date().toISOString()}`);
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
      // Bram has two tools and a model that chains tool calls gets cut off: allow one step, and filter tool names from speech as a backstop
      maxToolSteps: 2,
      ttsTextTransforms: ['filter_markdown', 'filter_emoji', speechFilter((what) => console.log(`speech filter removed a tool name from: ${what.slice(0, 120)}`))],
      userData: { ctx, players: [], scene_index: 0, last_scene_at: 0, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, short_mode: process.env.STORY_SHORT === '1', end_watcher: undefined, bram: undefined, ending: false, handoff_pending: false, pending_bots: [], handed_off: false },
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
      if (!item?.role || !item.textContent) return;
      console.log(`${item.role}: ${item.textContent}`);
      const data = session.userData;
      if (!data.handed_off || data.ending) return;
      // Player inputs are counted in Bram's onUserTurnCompleted. Here only Bram's own reply is kept, to see who he named.
      if (item.role === 'assistant') onBramReply(data, item.textContent);
    });
    // When Bram has finished speaking, code (not a model tool) gives the next turn: the player he named, or the next in rotation
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e: any) => {
      const data = session.userData;
      if (e.oldState !== 'speaking' || e.newState !== 'listening' || !data.handed_off || data.ending || !data.bram || data.scene_index === 0) return;
      const next = onPlayout(data, data.players);
      if (!next) return;
      const index = data.rotation;
      // Text input (a mute player's chat gesture) is accepted only from the participant being listened to, so link whoever's turn it is
      switchListener(session, next.identity);
      publish(data.ctx, { 'story.turn': next.identity, 'story.turn_name': next.name, 'story.turn_seq': String(data.inputs + data.scene_index * 100 + index) });
      console.log(`turn given to ${next.name} after playout (inputs=${data.inputs})`);
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
        // Chat text from the player being listened to: a mute player's gesture. It is a real player input, and Bram reacts to it as to a spoken answer.
        textInputCallback: (sess, ev) => {
          const data = session.userData;
          if (data.handed_off && !data.ending) {
            onPlayerInput(data);
            console.log(`player gesture counted: inputs=${data.inputs}`);
          }
          sess.interrupt();
          sess.generateReply({ userInput: ev.text, instructions: data.handed_off && !data.ending ? sceneHint(data.scene_index, data.inputs, data.ending) : undefined });
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
    // Open once the first guest is at the door: whether they gave a name decides Hester's first words
    await ctx.waitForParticipant();
    await hester.open(session);
  },
});

console.log(describeLlm());
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
