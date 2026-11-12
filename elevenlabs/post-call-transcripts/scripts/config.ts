import 'dotenv/config';
import { createHookdeckCli } from './hookdeck-cli';

import { SOURCE_NAME } from '../src/source-name';
export { SOURCE_NAME };
export const DESTINATION_NAME = 'local-elevenlabs';
export const CONNECTION_NAME = 'elevenlabs-post-call';
export const CLI_PATH = '/webhooks/elevenlabs';

export const cli = createHookdeckCli({ projectDir: __dirname + '/..' });
