import 'dotenv/config';
import { createHookdeckCli } from './hookdeck-cli';

export const cli = createHookdeckCli({ projectDir: __dirname + '/..' });

/** `npm run listen` forwards these sources. */
export const EVENTS_SOURCE = 'retell-call-events';
export const FUNCTION_SOURCE = 'retell-live-function';
export const LIVE_INJECTION = process.env.ENABLE_LIVE_INJECTION === 'true';
export const SOURCES = LIVE_INJECTION ? [EVENTS_SOURCE, FUNCTION_SOURCE] : [EVENTS_SOURCE];
