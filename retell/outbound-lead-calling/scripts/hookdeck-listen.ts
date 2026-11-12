// Generated from `_shared/hookdeck/hookdeck-listen.ts`; edit there and run `npm run sync-shared`.
/**
 * `hookdeck listen` wrapper: logs the CLI in to the demo's project, then
 * forwards the given sources to a local port. Exits with the CLI's exit code.
 *
 *   import { createHookdeckCli } from './hookdeck-cli';
 *   import { runListen } from './hookdeck-listen';
 *   runListen(createHookdeckCli(), ['my-source']);   // port: options.port, then $PORT, then 4000
 */
import { spawn } from 'child_process';
import type { HookdeckCli } from './hookdeck-cli';

export interface ListenOptions {
  port?: string | number;
  /** Extra arguments for `hookdeck listen`, e.g. ['--path', '/x']. */
  extraArgs?: string[];
}

export function runListen(cli: HookdeckCli, sources: string[], options: ListenOptions = {}): void {
  const port = String(options.port ?? process.env.PORT ?? '4000');
  cli.login();
  const child = spawn(cli.bin, cli.withConfig(['listen', port, sources.join(','), ...(options.extraArgs ?? [])]), {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
