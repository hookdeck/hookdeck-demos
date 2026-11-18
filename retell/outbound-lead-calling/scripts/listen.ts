/**
 * Forwards the demo's sources to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { SOURCES, cli } from './config';
import { runListen } from './hookdeck-listen';

runListen(cli, SOURCES);
