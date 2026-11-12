import * as fs from 'fs';
import * as path from 'path';

const PROJECT_DIR = path.join(__dirname, '..');
export const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');

/** Sets KEY=value lines in .env, creating it from .env.example if needed. */
export function writeEnv(values: { [key: string]: string }): void {
  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    console.log('Created .env from .env.example');
  }
  let env = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
  console.log(`Wrote ${Object.keys(values).join(', ')} to .env`);
}
