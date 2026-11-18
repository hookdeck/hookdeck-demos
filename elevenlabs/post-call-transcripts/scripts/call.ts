/**
 * Holds a short text-only conversation with your ElevenLabs agent, so a post-call webhook
 * fires without a microphone. It opens the agent's WebSocket with a signed URL, sends a few
 * user messages and hangs up.
 *
 *   npm run call
 *   npm run call -- "Hi, I'd like to book a haircut on Friday." "My name is Sam."
 *
 * Needs the agent to allow the text-only override (Agent -> Security -> Overrides ->
 * "Text only"), or to be a text-only agent. If it doesn't, use the agent's Test AI agent
 * button in the dashboard instead.
 */
import 'dotenv/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import WebSocket from 'ws';

const DEFAULT_MESSAGES = [
  'Hi, I would like to book a haircut on Friday afternoon.',
  'Three o clock works. My name is Sam.',
  'That is all, thank you. Goodbye.',
];

async function main() {
  const api_key = process.env.ELEVENLABS_API_KEY;
  const agent_id = process.env.ELEVENLABS_AGENT_ID;
  if (!api_key || !agent_id) {
    console.error('ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required. See .env.example.');
    process.exit(1);
  }
  const messages = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_MESSAGES;

  const elevenlabs = new ElevenLabsClient({ apiKey: api_key });
  const { signedUrl } = await elevenlabs.conversationalAi.conversations.getSignedUrl({ agentId: agent_id });

  const socket = new WebSocket(signedUrl);
  let next = 0;
  let conversation_id = '';

  const sendNext = () => {
    if (next >= messages.length) {
      // Give the agent time to answer the last message, then hang up
      return setTimeout(() => socket.close(1000), 4000);
    }
    const text = messages[next++];
    console.log(`user:  ${text}`);
    socket.send(JSON.stringify({ type: 'user_message', text }));
  };

  socket.on('open', () => {
    socket.send(
      JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: { conversation: { text_only: true } },
      }),
    );
  });

  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    switch (event.type) {
      case 'conversation_initiation_metadata':
        conversation_id = event.conversation_initiation_metadata_event?.conversation_id;
        console.log(`conversation ${conversation_id} started`);
        // An agent with no first message waits for the user, so speak first
        setTimeout(() => { if (next === 0) sendNext(); }, 2500);
        break;
      case 'agent_response':
        console.log(`agent: ${event.agent_response_event?.agent_response}`);
        setTimeout(sendNext, 500);
        break;
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong', event_id: event.ping_event?.event_id }));
        break;
    }
  });

  socket.on('close', (code, reason) => {
    console.log(`conversation ended (${code} ${reason.toString()})`);
    console.log('The post-call webhook arrives once ElevenLabs has finished the analysis (usually within a minute).');
    process.exit(0);
  });
  socket.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
