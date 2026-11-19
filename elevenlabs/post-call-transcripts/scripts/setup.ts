/**
 * Sets up both sides of the demo. Idempotent: safe to run multiple times.
 *
 * Hookdeck (project of HOOKDECK_API_KEY, through the Hookdeck API):
 *   source elevenlabs-post-call (type ELEVENLABS)  ->  CLI destination local-elevenlabs (/webhooks/elevenlabs)
 *   connection rules: deduplicate on event type + conversation_id, retry up to 5 times
 *
 * ElevenLabs (account of ELEVENLABS_API_KEY):
 *   0. a dedicated agent, "Hookdeck demo: post-call transcripts", created on the first run and
 *      updated on every run: greeting, booking prompt, turn timeout, data collection and an
 *      evaluation criterion. Your other agents are not touched.
 *   1. a workspace webhook that points at the Hookdeck source URL (HMAC auth). ElevenLabs
 *      returns its signing secret only when the webhook is created.
 *   2. the secret is set on the Hookdeck source, which then verifies ElevenLabs-Signature
 *   3. the webhook is attached to the demo agent for the transcript, audio and
 *      call_initiation_failure events
 *
 * Writes ELEVENLABS_AGENT_ID, ELEVENLABS_WEBHOOK_URL, ELEVENLABS_WEBHOOK_SECRET and ELEVENLABS_WEBHOOK_ID to .env.
 * To do the ElevenLabs part in the dashboard instead, see "Set up ElevenLabs by hand" in the README.
 */
import 'dotenv/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'fs';
import * as path from 'path';
import { CLI_PATH, CONNECTION_NAME, DESTINATION_NAME, SOURCE_NAME } from './config';
import { hookdeck, requireHookdeckApiKey } from './hookdeck-api';

const PROJECT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');
const WEBHOOK_NAME = 'hookdeck-post-call-demo';
const AGENT_NAME = 'Hookdeck demo: post-call transcripts';

// The demo agent. It greets first: an agent with no first message waits silently, and after
// turn_timeout the caller hears "are you still there?" before anything else. The prompt keeps
// it from promising lookups it has no tool for, which leaves the caller in silence.
const AGENT_CONFIG = {
  conversationConfig: {
    agent: {
      firstMessage: 'Hi, this is the Hookdeck Hair booking line. How can I help?',
      language: 'en',
      prompt: {
        prompt: [
          'You are the phone booking assistant for Hookdeck Hair, a hair salon.',
          'Help the caller book one appointment: the service, the day and time, and their name.',
          'Any slot the caller asks for between 9am and 6pm, Monday to Saturday, is free. Offer a nearby time otherwise.',
          'If they ask which stylists are available, name up to three: Alex, Priya and Sam.',
          'Answer straight away. You have no tools, so never say you will check, look up or pull up anything.',
          'Keep each reply to one or two short sentences. Confirm the booking once, then say goodbye.',
        ].join('\n'),
      },
    },
    turn: { turnTimeout: 10 },
  },
  platformSettings: {
    dataCollection: {
      caller_name: { type: 'string' as const, description: "The caller's name, if they gave it." },
      requested_service: { type: 'string' as const, description: 'The service the caller wants, for example haircut or colour.' },
      requested_time: { type: 'string' as const, description: 'The day and time of the appointment the caller agreed to.' },
    },
    evaluation: {
      criteria: [
        {
          id: 'booking_made',
          name: 'booking_made',
          type: 'prompt' as const,
          conversationGoalPrompt: 'The agent confirmed an appointment with a service, a day and time, and the caller name.',
        },
      ],
    },
  },
};

// One event per event type per conversation. ElevenLabs sends post_call_transcription,
// post_call_audio and call_initiation_failure with the same data.conversation_id, so the
// event type is part of the key. The window is the longest Hookdeck allows: one hour.
const RULES = [
  {
    type: 'deduplicate',
    window: 60 * 60 * 1000,
    include_fields: ['body.type', 'body.data.conversation_id'],
  },
  { type: 'retry', strategy: 'linear', count: 5, interval: 10 * 1000 },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('your_')) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

function writeEnv(values: { [key: string]: string }): void {
  if (!fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  let env = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
}

/**
 * Creates the connection with the Hookdeck API. One PUT /connections creates or updates the
 * ELEVENLABS source, the CLI destination and the rules, matched by name.
 */
async function setupHookdeck(): Promise<{ source_url: string; source_id: string }> {
  const connection = await hookdeck('PUT', '/connections', {
    name: CONNECTION_NAME,
    source: { name: SOURCE_NAME, type: 'ELEVENLABS' },
    destination: { name: DESTINATION_NAME, type: 'CLI', config: { path: CLI_PATH } },
    rules: RULES,
  });
  console.log(`Hookdeck: ${connection.source.url} -> ${DESTINATION_NAME} (${CLI_PATH})`);
  return { source_url: connection.source.url, source_id: connection.source.id };
}

/**
 * Sets the signing secret on the source (config.auth). The header name, algorithm and
 * timestamp format are fixed by the ELEVENLABS source type, so only the secret is needed.
 */
async function setSourceSecret(secret: string): Promise<void> {
  const source = await hookdeck('PUT', '/sources', {
    name: SOURCE_NAME,
    type: 'ELEVENLABS',
    config: { auth: { webhook_secret_key: secret } },
  });
  console.log(`Hookdeck: signature verification enabled on the source (auth ${source.config?.auth ? 'set' : 'NOT set'})`);
}

async function setupAgent(elevenlabs: ElevenLabsClient): Promise<string> {
  const { agents } = await elevenlabs.conversationalAi.agents.list({ search: AGENT_NAME, pageSize: 100 });
  const existing = agents.find((agent) => agent.name === AGENT_NAME);
  if (existing) {
    await elevenlabs.conversationalAi.agents.update(existing.agentId, AGENT_CONFIG);
    console.log(`ElevenLabs: updated agent "${AGENT_NAME}" (${existing.agentId})`);
    return existing.agentId;
  }
  const created = await elevenlabs.conversationalAi.agents.create({ name: AGENT_NAME, ...AGENT_CONFIG });
  console.log(`ElevenLabs: created agent "${AGENT_NAME}" (${created.agentId})`);
  return created.agentId;
}

async function setupElevenLabs(source_url: string): Promise<{ id: string; secret?: string; agent_id: string }> {
  const elevenlabs = new ElevenLabsClient({ apiKey: required('ELEVENLABS_API_KEY') });
  const agent_id = await setupAgent(elevenlabs);

  const { webhooks } = await elevenlabs.webhooks.list({});
  const existing = webhooks.find((webhook) => webhook.name === WEBHOOK_NAME && webhook.webhookUrl === source_url);

  let id: string;
  let secret: string | undefined;
  if (existing) {
    id = existing.webhookId;
    secret = process.env.ELEVENLABS_WEBHOOK_SECRET || undefined;
    console.log(`ElevenLabs: webhook ${WEBHOOK_NAME} already exists (${id})`);
    if (!secret) {
      console.error('ElevenLabs only shows the signing secret when a webhook is created.');
      console.error('Set ELEVENLABS_WEBHOOK_SECRET in .env, or delete the webhook in the ElevenLabs dashboard and run setup again.');
      process.exit(1);
    }
  } else {
    const created = await elevenlabs.webhooks.create({
      settings: { authType: 'hmac', name: WEBHOOK_NAME, webhookUrl: source_url },
    });
    id = created.webhookId;
    secret = created.webhookSecret;
    console.log(`ElevenLabs: created webhook ${WEBHOOK_NAME} (${id})`);
  }

  await elevenlabs.conversationalAi.agents.update(agent_id, {
    platformSettings: {
      workspaceOverrides: {
        webhooks: { postCallWebhookId: id, events: ['transcript', 'audio', 'call_initiation_failure'] },
      },
    },
  });
  console.log(`ElevenLabs: agent ${agent_id} sends transcript, audio and call_initiation_failure events to it`);
  return { id, secret, agent_id };
}

async function main(): Promise<void> {
  requireHookdeckApiKey();
  const { source_url } = await setupHookdeck();
  const { id, secret, agent_id } = await setupElevenLabs(source_url);
  if (secret) await setSourceSecret(secret);

  writeEnv({
    ELEVENLABS_AGENT_ID: agent_id,
    ELEVENLABS_WEBHOOK_URL: source_url,
    ELEVENLABS_WEBHOOK_ID: id,
    ...(secret ? { ELEVENLABS_WEBHOOK_SECRET: secret } : {}),
  });
  console.log('Wrote the agent ID and the webhook URL, ID and secret to .env');
  console.log('\nNext:\n  npm run listen\n  npm start\n  npm run call');
}

main().catch((error) => {
  console.error('Setup failed:', error.message || error);
  process.exit(1);
});
