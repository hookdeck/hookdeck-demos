/**
 * Creates the Hookdeck connection for the LiveKit call log and writes its Source
 * URL into .env. Idempotent: safe to run multiple times.
 *
 *   source livekit-call-log -> destination local-livekit-call-log (CLI, /webhooks/livekit)
 *
 * Uses the project whose HOOKDECK_API_KEY is in .env, through the hookdeck-cli
 * npm dependency with a config file of its own (see hookdeck-cli.ts).
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
import { SOURCE, cli } from './config';

const PROJECT_DIR = cli.projectDir;
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');

const CONNECTION = 'livekit-call-log';
const DESTINATION = 'local-livekit-call-log';
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
  cli.login();
  console.log(cli.whoami() || 'Not logged in: check HOOKDECK_API_KEY in .env');

  const source_type = (process.env.LIVEKIT_SOURCE_TYPE || 'WEBHOOK').toUpperCase();
  let auth: Record<string, unknown> | undefined;
  if (source_type === 'LIVEKIT') {
    // The LiveKit source type verifies deliveries with your project's API key and secret
    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env for the LIVEKIT source type.');
      process.exit(1);
    }
    // Both fields live under the source's config.auth; upsertSource sets them through the API.
    auth = { api_key: LIVEKIT_API_KEY, api_secret: LIVEKIT_API_SECRET };
  }
  const source = await cli.upsertSource({ name: SOURCE, type: source_type, auth });
  const destination = cli.upsertCliDestination({ name: DESTINATION, path: CLI_PATH });
  const connection = cli.upsertConnection({ name: CONNECTION, sourceId: source.id, destinationId: destination.id });

  console.log(`${CONNECTION}: ${connection.source.url} (${source_type}) -> ${DESTINATION} (${CLI_PATH})`);
  console.log('');
  writeEnv({ LIVEKIT_WEBHOOK_URL: connection.source.url });

  console.log('');
  console.log('Next:');
  console.log(`  1. Paste ${connection.source.url} into LiveKit Cloud -> Settings -> Webhooks`);
  console.log('  2. npm run listen');
  console.log('  3. npm start');
}

main().catch((error: any) => {
  console.error('Setup failed:', error.stderr?.toString().trim() || error.message);
  process.exit(1);
});
