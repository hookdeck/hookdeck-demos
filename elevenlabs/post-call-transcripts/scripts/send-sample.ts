/**
 * Sends a signed sample ElevenLabs webhook to the Hookdeck source, without making a call.
 * Useful to see deduplication and retries without a real conversation.
 *
 *   npm run send                      one post_call_transcription
 *   npm run send -- --duplicate       the same body twice (a re-delivery): Hookdeck's dedup rule drops the second
 *   npm run send -- --audio           transcription and audio for one conversation
 *   npm run send -- --failure         a call_initiation_failure
 *   npm run send -- --large 8         transcription padded to about 8 MB
 *
 * Needs ELEVENLABS_WEBHOOK_URL and ELEVENLABS_WEBHOOK_SECRET in .env (written by `npm run setup`).
 */
import 'dotenv/config';
import { audioEvent, conversationId, failureEvent, sign, transcriptionEvent } from '../src/samples';

const args = process.argv.slice(2);
const url = process.env.ELEVENLABS_WEBHOOK_URL;
const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (!url || !secret) {
  console.error('ELEVENLABS_WEBHOOK_URL and ELEVENLABS_WEBHOOK_SECRET are required: run `npm run setup` first.');
  process.exit(1);
}

async function post(payload: object, label: string) {
  const raw_body = JSON.stringify(payload);
  const response = await fetch(url!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'elevenlabs-signature': sign(secret!, raw_body) },
    body: raw_body,
  });
  console.log(`${label}: ${raw_body.length} bytes -> ${response.status}`);
}

async function main() {
  const id = conversationId();
  if (args.includes('--failure')) return post(failureEvent(id), 'call_initiation_failure');

  const transcription = transcriptionEvent(id);
  const large = args.indexOf('--large');
  if (large >= 0) {
    const megabytes = Number(args[large + 1] || 5);
    (transcription.data as any).metadata.padding = 'x'.repeat(Math.floor(megabytes * 1024 * 1024));
  }
  await post(transcription, 'post_call_transcription');

  if (args.includes('--duplicate')) await post(transcription, 'post_call_transcription (same body again)');
  if (args.includes('--audio')) await post(audioEvent(id), 'post_call_audio');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
