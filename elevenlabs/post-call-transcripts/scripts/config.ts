import 'dotenv/config';
import { createHookdeckCli } from './hookdeck-cli';

export const SOURCE_NAME = 'elevenlabs-post-call';
export const DESTINATION_NAME = 'local-elevenlabs';
export const CONNECTION_NAME = 'elevenlabs-post-call';
export const CLI_PATH = '/webhooks/elevenlabs';

export const cli = createHookdeckCli({ projectDir: __dirname + '/..' });
