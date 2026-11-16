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
import { describeLlm, chooseLlm, makeLlm } from './llm.ts';
import { planLedger } from './names.ts';

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
  /** Players who have had their turn in the current scene: each gets exactly one. */
  turn_taken: Set<string>;
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
function nextStep(greet: string[], bots: string[], unnamed: boolean, everyone: string): string {
  const greeting = greet.length
    ? `${greet.length === 1 ? greet[0] : greet.join(' and ')} told the page their name${greet.length === 1 ? '' : 's'}, so do not ask: greet ${greet.length === 1 ? 'them' : 'each'} by name in one short, in-character sentence (for example "Ah, ${greet[0]}, we've been expecting you") and they are already in the ledger. `
    : '';
  const mute = bots.length ? `${bots.join(' and ')} cannot speak, so do not ask: greet ${bots.length === 1 ? 'them' : 'each'} warmly too, in the same sentence or the next ("and your quiet friend, ${bots[0]}"), and write ${bots.length === 1 ? 'them' : 'each'} in the ledger. ` : '';
  const hello = `${greeting}${mute}`;
  return unnamed
    ? `${hello}Another traveller at the door gave no name and you can hear them now: ask them for their first name.`
    : `${hello}Everyone is in the ledger (${everyone}). In this same reply, say aloud that you will fetch Old Bram, who has been waiting all evening for a crowd, and call fetch_bram.`;
}

const switchListener = (session: voice.AgentSession<StoryData>, identity: string | null) => (session as any)._roomIO?.setParticipant(identity);
const listening_to = (session: voice.AgentSession<StoryData>): string | undefined => (session as any)._roomIO?.linkedParticipant?.identity;

/** What the page shows, published as attributes on the agent's own participant. */
const publish = (ctx: JobContext, attributes: Record<string, string>) => ctx.room.localParticipant?.setAttributes(attributes).catch(() => undefined);

/** The four scenes, in order. `scene` is the soundtrack the app pulls into the room. */
const SCENES = [
  { scene: 'tavern', text: 'the common room of the Drowned Bell on a stormy night, where a hooded stranger slides a salt-stained map across the table' },
  { scene: 'forest', text: 'the whispering path through the Hollow Wood to the Hollow Mere, where the trees seem to lean in and listen' },
  { scene: 'cave', text: 'the cave beneath the Mere, dark and dripping, where the Lantern of Hollow Mere is kept and something is breathing' },
  { scene: 'finale', text: 'the way home with the Lantern, and the one thing the players did that decides how the story ends' },
] as const;

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
    const intro = 'You are standing at the door of the inn, shaking the rain off your apron as travellers come in. ';
    session.generateReply({
      instructions: greet.length || bots.length || !unnamed.length
        ? `${intro}${nextStep(greet, bots, unnamed.length > 0, data.players.map((p) => p.name).join(', '))}`
        : `${intro}Greet them in one short sentence, say it is a wild night and the ledger is open, and ask the traveller you can hear for their first name.`,
    });
  }

  static build() {
    return new Hester({
      instructions: `You are Hester Pennywhistle, innkeeper of the Drowned Bell, a crooked old inn on the shore of the Hollow Mere. You are brisk, warm and a little nosy, with a dry sense of humour, and you call everyone "love" or "dear". You are a fictional character in a spoken adventure. ${BREVITY}
Travellers who come in out of the storm must sign your ledger. A traveller who already gave their name at the door is written in for you: greet them by name and never ask for it again. You can hear only one traveller at a time. Ask the one you can hear for their first name, then call write_in_ledger with it, and greet them by name. When the ledger tells you everyone is written in, say aloud, in one sentence and in your own words, that you will fetch Old Bram, who has been waiting all evening for a crowd to tell his tale to, and in that same reply call fetch_bram, so that the sentence and the call come together.`,
      tts: new inference.TTS({ model: HESTER_VOICE as any }),
      // A player talking over her must not cancel the handoff
      allowInterruptions: false,
      tools: {
        write_in_ledger: llm.tool({
          description: 'Write the first name of the traveller you can hear in the inn ledger.',
          parameters: z.object({ name: z.string().describe('The traveller\'s first name') }),
          execute: async ({ name }, { ctx }: llm.ToolOptions<StoryData>) => {
            const { players } = ctx.userData;
            const session = ctx.session as voice.AgentSession<StoryData>;
            // Only a plausible first name goes in the ledger: not "I", "the" or a sentence
            if (!/^\p{L}[\p{L}'-]{1,19}$/u.test(name.trim()) || ['the', 'my', 'me', 'and', 'light', 'home', 'way'].includes(name.trim().toLowerCase())) return `That did not sound like a first name. Ask the traveller again, in your own words, for just their first name.`;
            const identity = listening_to(session);
            if (identity && !players.some((p) => p.identity === identity)) players.push({ identity, name, bot: false });
            // Anyone who came in with a name on the page, and any bot, goes in the ledger without being asked
            const { greet, bots, unnamed } = registerKnown(ctx.userData);
            if (unnamed.length) {
              switchListener(session, unnamed[0]);
              return `${name} is in the ledger. ${nextStep(greet, bots, true, '')}`;
            }
            const first = players.find((p) => !p.bot);
            if (first) switchListener(session, first.identity);
            return `${name} is in the ledger. ${nextStep(greet, bots, false, players.map((p) => p.name).join(', '))}`;
          },
        }),
        fetch_bram: llm.tool({
          description: 'Hand the table over to Old Bram, the storyteller. Call it right after you have said you will fetch him.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            // Anyone who came in while Hester was talking (a bot, or a player who typed a name) is in the story too
            registerKnown(ctx.userData);
            return llm.handoff({ agent: Bram.build(ctx.userData.players), returns: 'Hester goes to fetch Old Bram.' });
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
      instructions: 'You have just come in from the fire at Hester\'s call. Introduce yourself in one sentence as Old Bram, retired keeper of the Hollow Light, glad of a crowd, and greet the travellers by name. Then call next_scene, set the first scene in two short sentences, and call give_turn for the first player.',
    });
  }

  static build(players: Player[]) {
    const roster = players.map((p) => (p.bot ? `${p.name} (a mute traveller who cannot speak and answers with gestures, which arrive as short text lines like "*Pixel taps the map.*" when you give it the turn)` : p.name)).join(', ');
    return new Bram({
      instructions: `You are Old Bram Tallow, a retired lighthouse keeper who tells stories at the Drowned Bell. You are slow, gravelly and kind, with dry humour and sea-worn turns of phrase, and you love a pause. You are a fictional character telling "The Lantern of Hollow Mere" to these travellers: ${roster}. ${BREVITY} Call tools silently: never write or say a tool name or function call in your speech.
The story has four scenes. Call next_scene to start each one: it plays that scene's soundtrack and tells you what the scene is. Never call it twice in a row, and never name the scenes in advance.
For each scene: call next_scene, set the scene in two short sentences, then call give_turn for each player in turn. give_turn tells you how to hand that turn over; follow it. Hand over once per reply and never ask two questions in one reply. React to each answer in one sentence that builds on what the player said, then move to the next player. Never repeat the way you handed over the turn before. A mute traveller such as Pixel never speaks: when you give it the turn, hand it the moment in one short sentence with no question, then stop and wait for its gesture, and weave that gesture into your reaction. Now and then, without being asked, mention what the mute traveller is doing in the corner of the scene. After the last player's turn in a scene, call next_scene again.
The finale is the last scene: give every player a turn, then speak a closing of up to four sentences that gathers up what each player did and ends the story with a memorable last line. Only after that, call end_story. Do not rush the ending. Keep the whole story to about six minutes.`,
      tts: new inference.TTS({ model: BRAM_VOICE as any }),
      allowInterruptions: false,
      tools: {
        next_scene: llm.tool({
          description: 'Start the next scene and its soundtrack. Returns what the scene is.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            // The model sometimes repeats a call: ignore a second one within 20 seconds
            if (Date.now() - data.last_scene_at < 20000) return `Scene ${data.scene_index} is already under way: set it in two short sentences.`;
            if (data.scene_index >= SCENES.length) return 'The story is over: speak your closing, then call end_story.';
            const { scene, text } = SCENES[data.scene_index++];
            data.last_scene_at = Date.now();
            data.turn_taken.clear();
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
            const last = data.scene_index === SCENES.length ? ' This is the finale: every player gets a turn, then your closing.' : '';
            return `Scene ${data.scene_index} of ${SCENES.length} has started ${music}: ${text}. Set it in two short sentences, then call give_turn for the first player.${last}`;
          },
        }),
        give_turn: llm.tool({
          description: 'Hand the turn to one player so you can hear them. Returns how to hand it over.',
          parameters: z.object({ player: z.string().describe('The player\'s name') }),
          execute: async ({ player }, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            const match = data.players.find((p) => p.name.toLowerCase() === player.toLowerCase());
            if (!match) return `No player called ${player}.`;
            // Exactly one turn per player per scene, so the story keeps moving
            if (data.turn_taken.has(match.identity)) {
              const unturned = data.players.find((p) => !data.turn_taken.has(p.identity));
              if (unturned) return `${match.name} has had a turn in this scene. Give the turn to ${unturned.name} instead.`;
            }
            if (data.players.every((p) => data.turn_taken.has(p.identity))) {
              return data.scene_index >= SCENES.length
                ? 'Every player has had a turn in the finale. Do not give another turn: speak your closing now (up to four sentences, ending on a memorable last line), then call end_story.'
                : 'Every player has had a turn in this scene. Do not give another turn: bring the scene to a close in one sentence and call next_scene.';
            }
            data.turn_taken.add(match.identity);
            const how = HANDOVERS[data.turns++ % HANDOVERS.length];
            publish(data.ctx, { 'story.turn': match.identity, 'story.turn_name': match.name, 'story.turn_seq': String(data.turns) });
            // Text input is accepted only from the participant being listened to: a mute player's gesture arrives as chat
            switchListener(ctx.session as voice.AgentSession<StoryData>, match.identity);
            if (match.bot) return `${match.name} is a mute traveller and cannot speak: hand ${match.name} the moment in one short sentence with no question, then stop and wait. ${match.name} will answer with a gesture, which you then weave into the story in your reaction.`;
            return `You can hear ${match.name} now. Hand the turn to ${match.name}: ${how}. Once, in this reply only.`;
          },
        }),
        end_story: llm.tool({
          description: 'End the story after your closing. The room closes shortly.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const job = ctx.userData.ctx;
            publish(job, { 'story.state': 'ended', 'story.turn': '', 'story.turn_name': '' });
            // Let the farewell finish playing, then leave the room
            setTimeout(() => job.shutdown('the story is over'), 14000);
            return 'The story has ended. Say one last short farewell line to the travellers now.';
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
      llm: makeLlm(process.env),
      userData: { ctx, players: [], scene_index: 0, last_scene_at: 0, turns: 0, turn_taken: new Set() },
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
      inputOptions: { closeOnDisconnect: false },
    });
    await ctx.connect();
    // onEnter ran before the room connected, so publish Hester's attributes again now
    await publish(ctx, { 'story.character': 'Hester Pennywhistle, innkeeper', 'story.state': 'playing', 'story.turn': '', 'story.turn_name': '' });
    // Open once the first guest is at the door: whether they gave a name decides Hester's first words
    await ctx.waitForParticipant();
    await hester.open(session);
  },
});

console.log(describeLlm(chooseLlm(process.env)));
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
