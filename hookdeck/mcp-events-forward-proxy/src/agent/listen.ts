import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Runs `hookdeck listen` for the agent's MCP Events sources, so Event Gateway
 * delivers to the agent on localhost with no public URL. The CLI is logged in
 * to the API key's project in a config file under run/, so it never touches
 * the user's own CLI login.
 *
 * `listen` resolves its connections when it starts (hookdeck-cli#467), so the
 * supervisor restarts it whenever the set of sources changes.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_DIR = resolve(ROOT, 'run');
const CLI_CONFIG = resolve(RUN_DIR, 'hookdeck-cli.toml');

/**
 * The CLI is an npm dependency, so the demo runs a known version. Resolve the
 * platform binary directly: the node_modules/.bin wrapper forwards no signals,
 * so stopping `listen` through it would kill it instead of closing its session.
 */
function cliPath(): string {
  if (process.env.HOOKDECK_CLI) return process.env.HOOKDECK_CLI;
  const arch = ({ x64: 'amd64', arm64: 'arm64', ia32: '386' } as Record<string, string>)[process.arch] ?? process.arch;
  const name = process.platform === 'win32' ? 'hookdeck.exe' : 'hookdeck';
  const direct = resolve(ROOT, `node_modules/hookdeck-cli/binaries/${process.platform}-${arch}/${name}`);
  return existsSync(direct) ? direct : resolve(ROOT, 'node_modules/.bin/hookdeck');
}

export class ListenSupervisor {
  private child?: ChildProcess;
  private sources: string[] = [];
  private stopping = false;
  private readonly cli = cliPath();

  constructor(
    private readonly port: number,
    apiKey: string,
    private readonly log: (message: string) => void,
  ) {
    mkdirSync(RUN_DIR, { recursive: true });
    const login = spawnSync(this.cli, ['ci', '--api-key', apiKey, '--hookdeck-config', CLI_CONFIG], { encoding: 'utf8' });
    if (login.status !== 0) throw new Error(`hookdeck ci failed:\n${login.stdout}${login.stderr}`);
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** Listens to exactly these sources, restarting `listen` if the set changed or it exited. */
  async listenTo(sourceNames: string[] = this.sources): Promise<void> {
    const next = [...new Set(sourceNames)].sort();
    if (this.running && next.join(',') === this.sources.join(',')) return;
    const restarting = this.running;
    await this.stop();
    this.sources = next;
    if (next.length === 0) return;
    this.stopping = false;
    this.log(`starting hookdeck listen for ${next.join(', ')}${restarting ? ' (restart: hookdeck-cli#467)' : ''}`);
    const child = spawn(this.cli, ['listen', String(this.port), next.join(','), '--output', 'compact', '--hookdeck-config', CLI_CONFIG], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    await new Promise<void>((ok, fail) => {
      let output = '';
      const timer = setTimeout(() => fail(new Error(`hookdeck listen did not connect:\n${output}`)), 30_000);
      const onData = (data: Buffer) => {
        output += data.toString();
        for (const line of data.toString().split('\n').filter(Boolean)) this.log(`[listen] ${line}`);
        if (output.includes('Connected')) {
          clearTimeout(timer);
          ok();
        }
      };
      child.stdout!.on('data', onData);
      child.stderr!.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (!this.stopping) this.log(`hookdeck listen exited (${code})`);
        fail(new Error(`hookdeck listen exited (${code}):\n${output}`));
      });
    });
  }

  /** Stops `listen` cleanly (SIGINT), so its CLI session closes rather than lingering. */
  stop(): Promise<void> {
    return this.end('SIGINT');
  }

  /**
   * Kills `listen` without letting it close its session, as a crash or a lost
   * network would. Event Gateway keeps the session for about 2 minutes.
   */
  kill(): Promise<void> {
    return this.end('SIGKILL');
  }

  private async end(signal: 'SIGINT' | 'SIGKILL'): Promise<void> {
    const child = this.child;
    if (!child || !this.running) return;
    this.stopping = true;
    this.child = undefined;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        done();
      });
      child.kill(signal);
    });
  }
}
