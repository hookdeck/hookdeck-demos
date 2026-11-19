/**
 * Creates the Hookdeck connection for the LiveKit call log and writes its Source
 * URL into .env. Idempotent: safe to run multiple times.
 *
 *   source livekit-voice-adventure -> destination local-livekit-voice-adventure (CLI, /webhooks/livekit),
 *   with a deduplicate rule (body.id) and an exponential retry rule
 *
 * Uses the project whose HOOKDECK_API_KEY is in .env, through the Hookdeck API
 * (see hookdeck-api.ts).
 *
 * TODO(hookdeck/core#6254): the LIVEKIT branch below is for when the LiveKit source
 * type ships; see the commented section in the README. Until then the source type
 * is WEBHOOK. The source type comes from LIVEKIT_SOURCE_TYPE in .env:
 *   WEBHOOK (default): a generic source. The app verifies each delivery with
 *                      LiveKit's WebhookReceiver.
 *   LIVEKIT:           Hookdeck verifies each delivery with your API key and
 *                      secret, and rejects forgeries before they reach your app.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SOURCE } from './config';
import { hookdeck, requireHookdeckApiKey } from './hookdeck-api';
import { RETRY_RULE } from '../src/config';
import { CLI_CONFIG_PATH, ensureWebhook, readCliConfig, resolveSession } from './livekit-cloud';

const PROJECT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');

const CONNECTION = 'livekit-voice-adventure';
const DESTINATION = 'local-livekit-voice-adventure';
const CLI_PATH = '/webhooks/livekit';

function writeEnv(values: { [key: string]: string }): void {
  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    console.log('Created .env from .env.example');
  }

  let env = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
  console.log(`Wrote ${Object.keys(values).join(', ')} to .env`);
}

async function main(): Promise<void> {
  require('dotenv').config({ path: ENV_FILE });
  requireHookdeckApiKey();

  const source_type = (process.env.LIVEKIT_SOURCE_TYPE || 'WEBHOOK').toUpperCase();

  // PUT /connections creates or updates the source, the CLI destination and the rules, matched by name.
  const connection = await hookdeck('PUT', '/connections', {
    name: CONNECTION,
    source: { name: SOURCE, type: source_type },
    destination: { name: DESTINATION, type: 'CLI', config: { path: CLI_PATH } },
    rules: [
      // The same LiveKit event id inside 10 minutes is a duplicate. The API takes the window in milliseconds.
      { type: 'deduplicate', window: 600000, include_fields: ['body.id'] },
      // If the app is down or erroring, retry for about two hours (30s, 60s, 2m, 4m, ...)
      { ...RETRY_RULE },
    ],
  });

  if (source_type === 'LIVEKIT') {
    // The LiveKit source type verifies deliveries with your project's API key and secret
    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env for the LIVEKIT source type.');
      process.exit(1);
    }
    // PUT /sources sets the source's verification settings (config.auth).
    await hookdeck('PUT', '/sources', {
      name: SOURCE,
      type: source_type,
      config: { auth: { api_key: LIVEKIT_API_KEY, api_secret: LIVEKIT_API_SECRET } },
    });
  }

  console.log(`${CONNECTION}: ${connection.source.url} (${source_type}) -> ${DESTINATION} (${CLI_PATH})`);
  console.log('');
  writeEnv({ LIVEKIT_WEBHOOK_URL: connection.source.url });

  console.log('');
  const registered = await registerLiveKitWebhook(connection.source.url);
  console.log('');
  console.log('Next:');
  if (!registered) {
    console.log(`  1. In LiveKit Cloud open Settings -> Webhooks -> Create new webhook, paste ${connection.source.url} as the URL,`);
    console.log(`     and choose the API key ${process.env.LIVEKIT_API_KEY} as the Signing API key.`);
    console.log('     (Or run `lk cloud auth --user-auth` and then `npm run setup` again to create it automatically.)');
  }
  console.log('  - npm run listen');
  console.log('  - npm start');
}

/** Creates the LiveKit Cloud webhook with the management API. Never fails setup: returns false when the dashboard step is needed. */
async function registerLiveKitWebhook(url: string): Promise<boolean> {
  const session = resolveSession(process.env, readCliConfig());
  if (!session) {
    console.log(`No LiveKit Cloud sign-in found (looked for LIVEKIT_SESSION_TOKEN and an unexpired session in ${CLI_CONFIG_PATH}).`);
    return false;
  }
  try {
    const result = await ensureWebhook(session, process.env, url, process.env.LIVEKIT_API_KEY || '');
    console.log(`LiveKit Cloud webhook ${result.action} (project ${result.project_id}, webhook ${result.webhook_id}).`);
    return true;
  } catch (error: any) {
    console.log(`Could not create the LiveKit Cloud webhook: ${error.message}`);
    return false;
  }
}

main().catch((error: any) => {
  console.error('Setup failed:', error.message);
  process.exit(1);
});
