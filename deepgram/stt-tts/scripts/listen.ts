/**
 * Forwards the demo's two sources to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { runListen } from './hookdeck-listen';
import { cli, SOURCES } from './hookdeck';

runListen(cli, SOURCES);
