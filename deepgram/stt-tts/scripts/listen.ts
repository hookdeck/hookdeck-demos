/**
 * Forwards the demo's two sources to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { spawn } from 'child_process';
import { HOOKDECK_CLI, SOURCES, login, withConfig } from './hookdeck-cli';

const PORT = process.env.PORT || '4000';

login();
const child = spawn(HOOKDECK_CLI, withConfig(['listen', PORT, SOURCES.join(',')]), { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
