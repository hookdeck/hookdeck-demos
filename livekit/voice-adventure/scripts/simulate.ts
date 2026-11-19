/**
 * Sends correctly signed LiveKit events to your Hookdeck source, without a LiveKit room.
 * The signature is the same kind LiveKit sends: a JWT in the Authorization header, issued by
 * LIVEKIT_API_KEY and signed with LIVEKIT_API_SECRET, with a `sha256` claim that is the hash of the body.
 *
 * Usage:
 *   npm run simulate                       # room_started, participant_joined, participant_left, room_finished for a new room
 *   npm run simulate -- room_finished      # one event
 *   npm run simulate -- room_finished --twice         # the same event twice (the second is deduplicated)
 *   npm run simulate -- room_finished --bad-signature # signed with the wrong secret: Event Gateway rejects it (VERIFICATION_FAILED) and the app is never called
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { AccessToken } from 'livekit-server-sdk';

const URL_ = process.env.LIVEKIT_WEBHOOK_URL;
const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

if (!URL_ || URL_.includes('your-source-id') || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_WEBHOOK_URL (run npm run setup), LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env.');
  process.exit(1);
}

const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const events = names.length ? names : ['room_started', 'participant_joined', 'participant_left', 'room_finished'];
const twice = args.includes('--twice');
const bad_signature = args.includes('--bad-signature');

const now = Math.floor(Date.now() / 1000);
const suffix = crypto.randomBytes(3).toString('hex');
const room = { sid: `RM_sim${suffix}`, name: `simulated-${suffix}`, creationTime: now };
const participant = { sid: `PA_sim${suffix}`, identity: 'alice', name: 'Alice', joinedAt: now };

async function send(event: string, id: string): Promise<void> {
  const body = JSON.stringify({
    id,
    event,
    createdAt: Math.floor(Date.now() / 1000),
    room,
    ...(event.startsWith('participant_') ? { participant } : {}),
  });
  const token = new AccessToken(LIVEKIT_API_KEY!, bad_signature ? `${LIVEKIT_API_SECRET}-wrong` : LIVEKIT_API_SECRET!);
  token.sha256 = crypto.createHash('sha256').update(body).digest('base64');
  const response = await fetch(URL_!, {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: await token.toJwt() },
    body,
  });
  console.log(`${event} (${id}) -> ${response.status}`);
}

(async () => {
  for (const event of events) {
    const id = `EV_sim${crypto.randomBytes(4).toString('hex')}`;
    await send(event, id);
    if (twice) await send(event, id);
  }
})();
