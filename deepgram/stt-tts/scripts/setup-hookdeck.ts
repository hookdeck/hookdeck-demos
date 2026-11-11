/**
 * Creates the Hookdeck connections for the Deepgram demos and writes their
 * Source URLs into .env. Idempotent: safe to run multiple times.
 *
 * Each demo gets its own source, CLI destination and connection:
 *   deepgram-tts: source deepgram-tts -> destination local-deepgram-tts (/tts/webhook)
 *   deepgram-stt: source deepgram-stt -> destination local-deepgram-stt (/stt/webhook)
 *
 * Uses the project whose HOOKDECK_API_KEY is in .env, through the hookdeck-cli
 * npm dependency with a config file of its own (see hookdeck-cli.ts). Set
 * HOOKDECK_CLI to use a different CLI binary (e.g. a local build).
 */
import * as fs from 'fs';
import * as path from 'path';
import { compareVersions } from './hookdeck-cli';
import { cli } from './hookdeck';

const PROJECT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');

// Binary webhook bodies (the TTS callback) need 3.1.0 or later
const LAST_CLI_WITHOUT_BINARY = '3.0.3';

interface Demo {
  connection: string;
  source: string;
  destination: string;
  cliPath: string;
  envVar: string;
}

const DEMOS: Demo[] = [
  {
    connection: 'deepgram-tts',
    source: 'deepgram-tts',
    destination: 'local-deepgram-tts',
    cliPath: '/tts/webhook',
    envVar: 'TTS_CALLBACK_URL',
  },
  {
    connection: 'deepgram-stt',
    source: 'deepgram-stt',
    destination: 'local-deepgram-stt',
    cliPath: '/stt/webhook',
    envVar: 'STT_CALLBACK_URL',
  },
];

function checkCli(): void {
  let version: string | undefined;
  try {
    version = cli.version();
  } catch {
    console.error(`❌ Hookdeck CLI not found (${cli.bin}). Install: https://hookdeck.com/docs/cli`);
    process.exit(1);
  }

  console.log(`Using Hookdeck CLI ${version || 'unknown version'}`);
  if (version && compareVersions(version, LAST_CLI_WITHOUT_BINARY) <= 0) {
    console.warn(`⚠️  CLI ${version} can't forward binary bodies, so the TTS demo won't receive audio.`);
    console.warn('   Upgrade to 3.1.0 or later.');
  }

  cli.login();
  const whoami = cli.whoami();
  console.log(whoami || 'Not logged in: check HOOKDECK_API_KEY in .env');
  console.log('');
}

function setupDemo(demo: Demo): string {
  const destination = cli.upsertCliDestination({ name: demo.destination, path: demo.cliPath });

  const connection = cli.upsertConnection({
    name: demo.connection,
    sourceName: demo.source,
    sourceType: 'WEBHOOK',
    destinationId: destination.id,
  });

  // An existing connection keeps its original destination: the API doesn't
  // change it on upsert. Earlier versions of this demo shared one destination
  // between both connections, so catch that here.
  if (connection.destination.id !== destination.id) {
    console.error(`❌ Connection ${demo.connection} points at destination ${connection.destination.name}, not ${demo.destination}.`);
    console.error(`   A connection's destination can't be changed. Delete it and run this script again:`);
    console.error(`   hookdeck gateway connection delete ${connection.id} --force`);
    process.exit(1);
  }

  console.log(`✅ ${demo.connection}: ${connection.source.url} -> ${demo.destination} (${demo.cliPath})`);
  return connection.source.url;
}

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

function main(): void {
  checkCli();

  const values: { [key: string]: string } = {};
  for (const demo of DEMOS) {
    values[demo.envVar] = setupDemo(demo);
  }

  console.log('');
  writeEnv(values);

  console.log('');
  console.log('Next:');
  console.log('  npm run listen');
  console.log('  npm start');
}

try {
  main();
} catch (error: any) {
  console.error('❌ Setup failed:', error.stderr?.toString().trim() || error.message);
  process.exit(1);
}
