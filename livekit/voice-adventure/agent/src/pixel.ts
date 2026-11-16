/**
 * Pixel: a silent, scripted player. The demo app starts this process when someone selects "Add a bot player".
 * It joins the room as `bot-pixel` (name "Pixel"), publishes no audio or video, and when the storyteller gives
 * it the turn (`story.turn` on the story agent's participant) it waits a moment and sends one gesture line as a
 * chat message on the `lk.chat` topic. That is the standard text input of an agent session, so the storyteller
 * reacts to it exactly as he would to a player's spoken answer, with no model call of Pixel's own.
 *
 * It is started with PIXEL_URL and PIXEL_TOKEN (a short-lived token the app minted: no key or secret here).
 */
import { ParticipantKind, Room, RoomEvent } from '@livekit/rtc-node';
import { gestureDelayMs, pickGesture, readAttributes, shouldGesture } from './pixel-lines.ts';

const url = process.env.PIXEL_URL;
const token = process.env.PIXEL_TOKEN;
if (!url || !token) {
  console.error('PIXEL_URL and PIXEL_TOKEN are required (the demo app sets them).');
  process.exit(1);
}

const room = new Room();
const used = new Set<string>();
let last_answered_seq: string | undefined;
let busy = false;

process.on('unhandledRejection', (error) => console.error('Pixel error:', error));
room.on(RoomEvent.Disconnected, () => process.exit(0));
process.on('SIGTERM', () => room.disconnect().finally(() => process.exit(0)));

await room.connect(url, token, { autoSubscribe: false, dynacast: false });
console.log('Pixel joined', room.name);

const story_agent = () => [...room.remoteParticipants.values()].find((p) => p.info.kind === ParticipantKind.AGENT);
let ended_at = 0;

// The agent's attributes change a few times a second at most: polling them is simple and cheap
setInterval(async () => {
  const agent = story_agent();
  if (!agent) return;
  const attrs = readAttributes(agent.attributes);
  if (attrs.state === 'ended') {
    ended_at ||= Date.now();
    if (Date.now() - ended_at > 8000) await room.disconnect();
    return;
  }
  if (busy || shouldGesture(attrs, last_answered_seq) !== 'gesture') return;
  console.log('Pixel: its turn (seq', attrs.turn_seq + ')');
  busy = true;
  last_answered_seq = attrs.turn_seq;
  setTimeout(async () => {
    const line = pickGesture(attrs.scene, used, Math.random, attrs.satchel);
    await room.localParticipant!.sendText(line, { topic: 'lk.chat' });
    console.log('Pixel:', line);
    busy = false;
  }, gestureDelayMs());
}, 500);

// Leave on our own after ten minutes, so a forgotten bot does not sit in a room
setTimeout(() => room.disconnect(), 10 * 60 * 1000).unref();
