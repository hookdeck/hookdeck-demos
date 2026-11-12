/**
 * Sets up both sides of the demo. Idempotent: safe to run multiple times.
 *
 * Hookdeck (project of HOOKDECK_API_KEY):
 *   source elevenlabs-post-call (type ELEVENLABS)  ->  CLI destination local-elevenlabs (/webhooks/elevenlabs)
 *   connection rules: deduplicate on event type + conversation_id, retry up to 5 times
 *
 * ElevenLabs (account of ELEVENLABS_API_KEY):
 *   1. a workspace webhook that points at the Hookdeck source URL (HMAC auth). ElevenLabs
 *      returns its signing secret only when the webhook is created.
 *   2. the secret is set on the Hookdeck source, which then verifies ElevenLabs-Signature
 *   3. the webhook is attached to your agent for the transcript, audio and
 *      call_initiation_failure events
 *
 * Writes ELEVENLABS_WEBHOOK_URL, ELEVENLABS_WEBHOOK_SECRET and ELEVENLABS_WEBHOOK_ID to .env.
 * To do the ElevenLabs part in the dashboard instead, see "Set up ElevenLabs by hand" in the README.
 */
import 'dotenv/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'fs';
import * as path from 'path';
import { CLI_PATH, CONNECTION_NAME, DESTINATION_NAME, SOURCE_NAME, cli } from './config';

const PROJECT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');
const WEBHOOK_NAME = 'hookdeck-post-call-demo';

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

async function setupHookdeck(): Promise<{ source_url: string; source_id: string }> {
  cli.login();
  console.log(cli.whoami() || 'Not logged in: check HOOKDECK_API_KEY in .env');

  const destination = cli.upsertCliDestination({ name: DESTINATION_NAME, path: CLI_PATH });
  const connection = cli.upsertConnection({
    name: CONNECTION_NAME,
    sourceName: SOURCE_NAME,
    sourceType: 'ELEVENLABS',
    destinationId: destination.id,
    rules: RULES,
  });
  console.log(`Hookdeck: ${connection.source.url} -> ${DESTINATION_NAME} (${CLI_PATH})`);
  return { source_url: connection.source.url, source_id: connection.source.id };
}

/**
 * Sets the signing secret on the source through the API (config.auth). The header name,
 * algorithm and timestamp format are fixed by the ELEVENLABS source type, so only the secret is needed.
 */
async function setSourceSecret(secret: string): Promise<void> {
  const source = await cli.upsertSource({
    name: SOURCE_NAME,
    type: 'ELEVENLABS',
    auth: { webhook_secret_key: secret },
  });
  console.log(`Hookdeck: signature verification enabled on the source (auth ${source.auth_applied ? 'applied' : 'not applied'})`);
}

async function setupElevenLabs(source_url: string): Promise<{ id: string; secret?: string }> {
  const elevenlabs = new ElevenLabsClient({ apiKey: required('ELEVENLABS_API_KEY') });
  const agent_id = required('ELEVENLABS_AGENT_ID');

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
  return { id, secret };
}

async function main(): Promise<void> {
  const { source_url } = await setupHookdeck();
  const { id, secret } = await setupElevenLabs(source_url);
  if (secret) await setSourceSecret(secret);

  writeEnv({
    ELEVENLABS_WEBHOOK_URL: source_url,
    ELEVENLABS_WEBHOOK_ID: id,
    ...(secret ? { ELEVENLABS_WEBHOOK_SECRET: secret } : {}),
  });
  console.log('Wrote the webhook URL, ID and secret to .env');
  console.log('\nNext:\n  npm run listen\n  npm start\n  npm run call');
}

main().catch((error) => {
  console.error('Setup failed:', error.stderr?.toString().trim() || error.message || error);
  process.exit(1);
});
