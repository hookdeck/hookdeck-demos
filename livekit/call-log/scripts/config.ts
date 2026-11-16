import 'dotenv/config';
import { createHookdeckCli } from './hookdeck-cli';

export const cli = createHookdeckCli({ projectDir: __dirname + '/..' });

/** The demo's single source; `npm run listen` forwards it. */
export const SOURCE = 'livekit-call-log';
