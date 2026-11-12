/**
 * Forwards the demo's Hookdeck source to the local server (PORT from .env, default 4000)
 * with `hookdeck listen`, using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { SOURCE_NAME, cli } from './config';
import { runListen } from './hookdeck-listen';

runListen(cli, [SOURCE_NAME]);
