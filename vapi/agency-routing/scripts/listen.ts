/**
 * Forwards both client sources to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { CLIENTS } from '../src/clients';
import { createHookdeckCli } from './hookdeck-cli';
import { runListen } from './hookdeck-listen';

runListen(createHookdeckCli(), CLIENTS.map((c) => c.source));
