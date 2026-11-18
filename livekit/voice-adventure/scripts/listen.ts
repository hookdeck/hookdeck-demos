/**
 * Forwards the demo's source to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { SOURCE, cli } from './config';
import { runListen } from './hookdeck-listen';

runListen(cli, [SOURCE]);
