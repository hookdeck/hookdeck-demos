/**
 * Forwards the demo's Hookdeck source to the local server with `hookdeck listen`,
 * using the project whose API key is in .env.
 *
 * Usage: npm run listen
 */
import { spawn } from 'child_process';
import { HOOKDECK_CLI, SOURCE_NAME, login, withConfig } from './hookdeck-cli';

const PORT = process.env.PORT || '4000';

login();
const child = spawn(HOOKDECK_CLI, withConfig(['listen', PORT, SOURCE_NAME]), { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
