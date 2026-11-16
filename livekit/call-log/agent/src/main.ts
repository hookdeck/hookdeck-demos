/**
 * The agents for the call log demo: an intro agent that learns each player's name, then a game master
 * that runs a short collaborative adventure of four scenes. Both are one agent participant in the
 * room, handed off with `llm.handoff`. At each new scene the game master calls `next_scene`, which
 * asks the demo app to pull that scene's soundtrack into the room with LiveKit's Ingress API.
 *
 * Speech-to-text, the language model and text-to-speech all run on LiveKit Inference, so the only
 * credentials are the LiveKit project's API key and secret. Run it with `npm run agent`.
 */
import { type JobContext, ServerOptions, cli, defineAgent, inference, llm, voice } from '@livekit/agents';
import { ParticipantKind, type RemoteParticipant } from '@livekit/rtc-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** Must match AGENT_NAME in ../src/token.ts: the token's room configuration dispatches this name. */
const AGENT_NAME = 'story-gm';
const APP_URL = process.env.STORY_APP_URL || `http://localhost:${process.env.PORT || 4000}`;

interface Player {
  identity: string;
  name: string;
  /** A silent test participant ("Add a test participant" on the page): the game master voices its turns. */
  bot: boolean;
}

interface StoryData {
  ctx: JobContext;
  players: Player[];
  /** Scenes started so far, and when the last one started (a repeated call within seconds is ignored). */
  scene_index: number;
  last_scene_at: number;
}

const is_bot = (p: RemoteParticipant) => p.identity.startsWith('bot-');
const is_player = (p: RemoteParticipant) => p.info.kind === ParticipantKind.STANDARD || p.info.kind === undefined;
const humans = (ctx: JobContext) => [...ctx.room.remoteParticipants.values()].filter((p) => is_player(p) && !is_bot(p));

const switchListener = (session: voice.AgentSession<StoryData>, identity: string | null) => (session as any)._roomIO?.setParticipant(identity);
const listening_to = (session: voice.AgentSession<StoryData>): string | undefined => (session as any)._roomIO?.linkedParticipant?.identity;

/** The four scenes, in order. `scene` is the soundtrack the app pulls into the room. */
const SCENES = [
  { scene: 'tavern', text: 'a warm, noisy inn where the party meets and a hooded stranger offers a map' },
  { scene: 'forest', text: 'the path to the Hollow Mere through whispering trees' },
  { scene: 'cave', text: 'the dark cave under the lake where the Lantern is kept' },
  { scene: 'finale', text: 'carrying the Lantern home, with a twist of the players\' own making' },
] as const;

const BREVITY = 'You speak aloud, so use at most two short sentences at a time, with no lists, no stage directions and no emoji.';

class IntroAgent extends voice.Agent<StoryData> {
  async onEnter() {
    this.session.generateReply({
      instructions: 'Greet the players warmly in one sentence, say you will host a short adventure, and ask the player you can hear for their first name.',
    });
  }

  static build() {
    return new IntroAgent({
      instructions: `You are Marla, the host who gets a group ready for a short spoken adventure. ${BREVITY}
You can hear only one player at a time. Ask the player you can hear for their first name, then call register_player with it. Do nothing else until that player has given a name.`,
      tts: new inference.TTS({ model: 'cartesia/sonic-3', voice: '794f9389-aac1-45b6-b726-9d9369183238' }),
      tools: {
        register_player: llm.tool({
          description: 'Record the first name of the player you can hear.',
          parameters: z.object({ name: z.string().describe('The player\'s first name') }),
          execute: async ({ name }, { ctx }: llm.ToolOptions<StoryData>) => {
            const { ctx: job, players } = ctx.userData;
            const identity = listening_to(ctx.session as voice.AgentSession<StoryData>);
            if (identity && !players.some((p) => p.identity === identity)) players.push({ identity, name, bot: false });
            const next = humans(job).find((p) => !players.some((q) => q.identity === p.identity));
            if (next) {
              switchListener(ctx.session as voice.AgentSession<StoryData>, next.identity);
              return `Registered ${name}. Another player is in the room and you can hear them now: welcome them and ask for their first name.`;
            }
            // Silent test participants join the story without speaking: the game master voices their turns
            for (const p of job.room.remoteParticipants.values()) {
              if (is_bot(p) && !players.some((q) => q.identity === p.identity)) players.push({ identity: p.identity, name: p.name || `${p.identity.slice(4, 5).toUpperCase()}${p.identity.slice(5)}`, bot: true });
            }
            const first = players.find((p) => !p.bot);
            if (first) switchListener(ctx.session as voice.AgentSession<StoryData>, first.identity);
            return llm.handoff({ agent: GameMaster.build(players), returns: `${players.map((p) => p.name).join(' and ')} are ready. The game master takes over.` });
          },
        }),
      },
    });
  }
}

class GameMaster extends voice.Agent<StoryData> {
  async onEnter() {
    this.session.generateReply({
      instructions: 'Introduce yourself as the game master in one sentence. Then call next_scene and set the first scene in two short sentences, then call give_turn for the first player.',
    });
  }

  static build(players: Player[]) {
    const roster = players.map((p) => (p.bot ? `${p.name} (a silent bot: voice its turns yourself in one sentence)` : p.name)).join(', ');
    return new GameMaster({
      instructions: `You are the game master of a short collaborative fantasy adventure, "The Lantern of Hollow Mere". Players: ${roster}. ${BREVITY}
The story has four scenes. Call next_scene to start each one: it plays the scene's soundtrack and tells you what the scene is. Never call it twice in a row, and never name the scenes in advance.
For each scene: call next_scene, set the scene in two short sentences, then call give_turn for each player in turn. For a turn, ask "what do you do?" and react to the answer in one sentence. After the last player's turn in a scene, call next_scene again. When next_scene says the story is over, say a one-sentence goodbye and call end_story. Keep the pace brisk: the whole story takes about five minutes.`,
      tts: new inference.TTS({ model: 'cartesia/sonic-3', voice: 'a167e0f3-df7e-4d52-a9c3-f949145efdab' }),
      tools: {
        next_scene: llm.tool({
          description: 'Start the next scene and its soundtrack. Returns what the scene is.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const data = ctx.userData;
            // The model sometimes repeats a call: ignore a second one within 20 seconds
            if (Date.now() - data.last_scene_at < 20000) return `Scene ${data.scene_index} is already under way: set it in two short sentences.`;
            if (data.scene_index >= SCENES.length) return 'The story is over: say a one-sentence goodbye, then call end_story.';
            const { scene, text } = SCENES[data.scene_index++];
            data.last_scene_at = Date.now();
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
            return `Scene ${data.scene_index} of ${SCENES.length} has started ${music}: ${text}. Set it in two short sentences, then call give_turn for the first player.`;
          },
        }),
        give_turn: llm.tool({
          description: 'Hand the turn to one player so you can hear them.',
          parameters: z.object({ player: z.string().describe('The player\'s name') }),
          execute: async ({ player }, { ctx }: llm.ToolOptions<StoryData>) => {
            const match = ctx.userData.players.find((p) => p.name.toLowerCase() === player.toLowerCase());
            if (!match) return `No player called ${player}.`;
            if (match.bot) return `${match.name} is a silent bot: say in one sentence what ${match.name} does.`;
            switchListener(ctx.session as voice.AgentSession<StoryData>, match.identity);
            return `You can hear ${match.name} now.`;
          },
        }),
        end_story: llm.tool({
          description: 'End the session after your goodbye.',
          parameters: z.object({}),
          execute: async (_args, { ctx }: llm.ToolOptions<StoryData>) => {
            const job = ctx.userData.ctx;
            // Let the goodbye finish playing, then leave the room
            setTimeout(() => job.shutdown('the story is over'), 9000);
            return 'The story is over. Say your goodbye now.';
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
      llm: new inference.LLM({ model: 'openai/gpt-4.1-mini' }),
      userData: { ctx, players: [], scene_index: 0, last_scene_at: 0 },
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

    await session.start({
      agent: IntroAgent.build(),
      room: ctx.room,
      inputOptions: { closeOnDisconnect: false },
    });
    await ctx.connect();
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
