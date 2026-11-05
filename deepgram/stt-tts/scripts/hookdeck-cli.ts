/**
 * Runs the Hookdeck CLI against the project whose API key is in .env, using a
 * CLI config file of its own (run/hookdeck-cli.toml). The demo never touches
 * whatever project you're logged in to interactively.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_DIR = path.join(__dirname, '..');
const RUN_DIR = path.join(PROJECT_DIR, 'run');
const CLI_CONFIG = path.join(RUN_DIR, 'hookdeck-cli.toml');

// The hookdeck-cli npm dependency, unless HOOKDECK_CLI points somewhere else
export const HOOKDECK_CLI =
  process.env.HOOKDECK_CLI ||
  path.join(PROJECT_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'hookdeck.cmd' : 'hookdeck');

// One source per demo; `npm run listen` forwards only these
export const SOURCES = ['deepgram-tts', 'deepgram-stt'];

/** Exits with a hint when HOOKDECK_API_KEY isn't set. */
export function requireApiKey(): string {
  const key = process.env.HOOKDECK_API_KEY;
  if (!key || key.startsWith('your_')) {
    console.error('❌ HOOKDECK_API_KEY is not set. Add a project API key to .env');
    console.error('   (Hookdeck dashboard: Project settings -> API keys).');
    process.exit(1);
  }
  return key;
}

/** Logs the CLI in to the API key's project, in the demo's own config file. */
export function login(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  execFileSync(HOOKDECK_CLI, ['ci', '--api-key', requireApiKey(), '--hookdeck-config', CLI_CONFIG], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** CLI arguments with the demo's config file appended. */
export const withConfig = (args: string[]): string[] => [...args, '--hookdeck-config', CLI_CONFIG];
