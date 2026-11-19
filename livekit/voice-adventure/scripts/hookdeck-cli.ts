// Generated from `_shared/hookdeck/hookdeck-cli.ts`; edit there and run `npm run sync-shared`.
/**
 * Hookdeck CLI helper for demo setup and listen scripts.
 *
 * Runs the Hookdeck CLI against the project whose API key is in HOOKDECK_API_KEY
 * (loaded from .env), using a CLI config file of the demo's own
 * (run/hookdeck-cli.toml). The demo never touches whatever project you are
 * logged in to interactively.
 *
 * Needs Node 22+, `dotenv` and the `hookdeck-cli` npm package in the demo.
 *
 *   const cli = createHookdeckCli();            // paths are relative to process.cwd()
 *   cli.login();
 *   const destination = cli.upsertCliDestination({ name: 'local-x', path: '/webhook' });
 *   const connection = cli.upsertConnection({
 *     name: 'x', sourceName: 'x', sourceType: 'WEBHOOK', destinationId: destination.id,
 *   });
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface HookdeckCliOptions {
  /** Demo root: where node_modules and run/ live. Defaults to process.cwd(), which is the demo folder under `npm run`. */
  projectDir?: string;
  /** Where the CLI config and private temp files go. Defaults to <projectDir>/run. */
  runDir?: string;
  /** CLI binary. Defaults to $HOOKDECK_CLI, then the hookdeck-cli npm dependency. */
  bin?: string;
  /** Hookdeck API base URL, used by api() (probe reads). */
  apiBase?: string;
}

export interface SourceSpec {
  name: string;
  /** Source type, e.g. WEBHOOK, VAPI, ELEVENLABS, RETELL, LIVEKIT. */
  type: string;
  /** Non-secret source config (e.g. { trim_payload }). Passed through a private temp file, never on the command line. */
  config?: Record<string, unknown>;
  /**
   * Signature verification settings, i.e. the API's `config.auth` (e.g. VAPI:
   * { webhook_secret_key, algorithm, encoding, header_key }). Merged into the config file the CLI
   * reads, so it needs hookdeck-cli 3.2.0 or later.
   */
  auth?: Record<string, unknown>;
}

export interface ConnectionSpec {
  name: string;
  destinationId: string;
  /** Use an existing source... */
  sourceId?: string;
  /** ...or create/reuse one by name and type. */
  sourceName?: string;
  sourceType?: string;
  /** Connection rules (filter, transform, retry, delay, deduplicate...). */
  rules?: Array<Record<string, unknown>>;
}

/** Compares dotted numeric versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function createHookdeckCli(options: HookdeckCliOptions = {}) {
  const project_dir = options.projectDir ?? process.cwd();
  const run_dir = options.runDir ?? path.join(project_dir, 'run');
  const cli_config = path.join(run_dir, 'hookdeck-cli.toml');
  const api_base = options.apiBase ?? 'https://api.hookdeck.com/2025-07-01';
  const bin =
    options.bin ||
    process.env.HOOKDECK_CLI ||
    path.join(project_dir, 'node_modules', '.bin', process.platform === 'win32' ? 'hookdeck.cmd' : 'hookdeck');

  /** Exits with a hint when HOOKDECK_API_KEY isn't set. */
  function requireApiKey(): string {
    const key = process.env.HOOKDECK_API_KEY;
    if (!key || key.startsWith('your_')) {
      console.error('❌ HOOKDECK_API_KEY is not set. Add a project API key to .env');
      console.error('   (Hookdeck dashboard: Project settings -> API keys).');
      process.exit(1);
    }
    return key;
  }

  /** Replaces the API key in `text` with "[key]", so an error message or CLI output never prints it. */
  function redact(text: string): string {
    const key = process.env.HOOKDECK_API_KEY;
    return key ? text.split(key).join('[key]') : text;
  }

  /** Rethrows a failed CLI call with the API key removed from its message and output. */
  function scrub(error: any): never {
    error.message = redact(String(error.message));
    for (const stream of ['stdout', 'stderr']) if (error[stream]) error[stream] = redact(error[stream].toString());
    throw error;
  }

  /**
   * Logs the CLI in to the API key's project, in the demo's own config file. The key reaches the CLI
   * as HOOKDECK_API_KEY (which `hookdeck ci` reads when --api-key is absent), not on the command line,
   * where `ps` would show it.
   */
  function login(): void {
    fs.mkdirSync(run_dir, { recursive: true });
    const api_key = requireApiKey();
    try {
      execFileSync(bin, ['ci', '--hookdeck-config', cli_config], {
        env: { ...process.env, HOOKDECK_API_KEY: api_key },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      scrub(error);
    }
  }

  /** CLI arguments with the demo's config file appended. */
  const withConfig = (args: string[]): string[] => [...args, '--hookdeck-config', cli_config];

  /** Runs a CLI command against the demo's project and returns stdout. */
  function run(args: string[]): string {
    try {
      return execFileSync(bin, withConfig(args), { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return scrub(error);
    }
  }

  /** Runs a CLI command with `--output json` and parses stdout. */
  function json<T = any>(args: string[]): T {
    return JSON.parse(run([...args, '--output', 'json']));
  }

  /** Installed CLI version, e.g. "3.1.0", or undefined if it can't be read. Throws if the binary isn't found. */
  function version(): string | undefined {
    return run(['version']).match(/(\d+\.\d+\.\d+)/)?.[1];
  }

  /** The "Logged in as ..." line from `hookdeck whoami`. */
  function whoami(): string | undefined {
    return run(['whoami']).split('\n').find((line) => line.startsWith('Logged in as'));
  }

  /** Writes a file only the current user can read. */
  function writePrivateFile(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o600 });
  }

  /** Runs `fn` with a private temp file holding `value` as JSON, and removes the file afterwards. */
  function withPrivateJson<T>(name: string, value: unknown, fn: (file: string) => T): T {
    const file = path.join(run_dir, name);
    writePrivateFile(file, JSON.stringify(value));
    try {
      return fn(file);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  /**
   * Creates or updates a source through the CLI. `config` and `auth` go together into the source
   * config file (`--config-file`), so the CLI sets verification exactly as given: the provider's
   * header, algorithm and encoding stay whatever you pass, and types whose auth is more than one
   * secret (LIVEKIT's api_key and api_secret) work too. Needs hookdeck-cli 3.2.0 or later, where
   * source auth is applied correctly (3.1.0 left VAPI on the wrong header and failed on WEBHOOK).
   *
   * The secret travels in a private temp file, never on the command line. The API redacts `auth`
   * when you read a source back, so a signed + unsigned probe request is the end-to-end proof.
   */
  function upsertSource(spec: SourceSpec): any {
    const args = ['gateway', 'source', 'upsert', spec.name, '--type', spec.type];
    const config = spec.auth ? { ...spec.config, auth: spec.auth } : spec.config;
    return config
      ? withPrivateJson(`source-${spec.name}.json`, config, (file) => json([...args, '--config-file', file]))
      : json(args);
  }

  function upsertCliDestination(spec: { name: string; path: string }): any {
    return json(['gateway', 'destination', 'upsert', spec.name, '--type', 'CLI', '--cli-path', spec.path]);
  }

  /**
   * Creates or updates a connection. Note the API doesn't change an existing
   * connection's destination: compare connection.destination.id to the one you
   * passed when re-running against older setups.
   */
  function upsertConnection(spec: ConnectionSpec): any {
    const args = ['gateway', 'connection', 'upsert', spec.name, '--destination-id', spec.destinationId];
    if (spec.sourceId) args.push('--source-id', spec.sourceId);
    if (spec.sourceName) args.push('--source-name', spec.sourceName);
    if (spec.sourceType) args.push('--source-type', spec.sourceType);
    if (!spec.rules) return json(args);
    return withPrivateJson(`rules-${spec.name}.json`, spec.rules, (file) => json([...args, '--rules-file', file]));
  }

  /** Calls the Hookdeck API with the project API key. Demos that set up through the API use hookdeck-api.ts instead. */
  async function api<T = any>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${api_base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${requireApiKey()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Hookdeck API ${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : (undefined as T);
  }

  return {
    bin,
    projectDir: project_dir,
    runDir: run_dir,
    cliConfig: cli_config,
    requireApiKey,
    login,
    withConfig,
    run,
    json,
    version,
    whoami,
    writePrivateFile,
    upsertSource,
    upsertCliDestination,
    upsertConnection,
    api,
  };
}

export type HookdeckCli = ReturnType<typeof createHookdeckCli>;
