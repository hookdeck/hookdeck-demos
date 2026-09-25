/**
 * Process manager for the simulated fleet.
 *
 *   fleet up      <approach> [machine...]   start machines (all if none named)
 *   fleet down    <approach> [machine...]   clean shutdown (SIGTERM)
 *   fleet crash   <approach> [machine...]   simulated crash (SIGKILL)
 *   fleet status  [approach]                what is running
 *   fleet logs    <approach> <machine>      tail a machine's log
 *
 * Machines are spawned detached, so each gets its own process group. Signals
 * go to the group (negative PID) so the supervisor and its `hookdeck listen`
 * child are stopped or killed together. That distinction is the whole point of
 * scenarios 2, 3 and 5: a clean stop drops the Hookdeck session immediately, a
 * kill leaves it in the reconnect grace window.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyScenarioArg,
  ROOT,
  logPath,
  machines,
  portOf,
  connectionName,
  runDir,
  groupOf,
  type Approach,
} from "./config.js";
import { ciLogin } from "./hookdeck.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPROACHES: Approach[] = ["per-machine", "per-group"];

const pidFile = (approach: Approach, name: string): string =>
  resolve(runDir(), `${approach}.${name}.pid`);

function readPid(approach: Approach, name: string): number | undefined {
  const file = pidFile(approach, name);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isFinite(pid) ? pid : undefined;
}

/** A process group is alive if signal 0 to the negative PID does not throw. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Block until the process group is gone, or the timeout expires. */
function waitForGroupExit(pid: number, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) return true;
    // Synchronous sleep: this is a CLI, and the alternative is returning
    // before the thing we were asked to stop has stopped.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return !groupAlive(pid);
}

function resolveTargets(args: string[]): string[] {
  const all = machines().map((m) => m.name);
  if (args.length === 0) return all;
  for (const a of args) {
    if (!all.includes(a)) throw new Error(`Unknown machine ${a}. Known: ${all.join(", ")}`);
  }
  return args;
}

export interface MachineStatus {
  name: string;
  group: string;
  up: boolean;
  /**
   * The machine is running but its listener is suspended, so it has no link to
   * Hookdeck. Distinct from `up: false`, where the machine itself is gone - and
   * the distinction matters, because an offline machine keeps its session and
   * picks up what it missed when it comes back.
   */
  offline: boolean;
  /** A CLI session is attached. False once `disconnect` stops the listener. */
  listening: boolean;
  port: number;
  connection: string;
  pid?: number;
}

/** True when the listener process exists but is stopped (SIGSTOP). */
function listenerSuspended(approach: Approach, name: string): boolean {
  const file = listenerPidFile(approach, name);
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, "utf8").trim());
  if (!Number.isFinite(pid)) return false;
  const res = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  // A stopped process reports a state beginning with T on macOS and Linux.
  return (res.stdout ?? "").trim().startsWith("T");
}

export function up(approach: Approach, names: string[]): void {
  mkdirSync(runDir(), { recursive: true });
  ciLogin();

  for (const name of names) {
    const existing = readPid(approach, name);
    if (existing && groupAlive(existing)) {
      console.log(`  = ${name} already running (pgid ${existing})`);
      continue;
    }

    const log = logPath(approach, name);
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `\n=== ${new Date().toISOString()} starting ${name} (${approach}) ===\n`);
    const fd = openSync(log, "a");

    const child = spawn(
      process.execPath,
      [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), resolve(HERE, "machine.ts"), approach, name],
      {
        cwd: ROOT,
        // Own process group, so signals can reach the listener too.
        detached: true,
        stdio: ["ignore", fd, fd],
      },
    );
    child.unref();

    writeFileSync(pidFile(approach, name), String(child.pid));
    console.log(
      `  + ${name} pgid=${child.pid} port=${portOf(approach, name)} ` +
        `connection=${connectionName(approach, name)}`,
    );
  }
}

const listenerPidFile = (approach: Approach, name: string): string =>
  resolve(runDir(), `${approach}.${name}.listener.pid`);

/**
 * Take a machine's link to Hookdeck offline, or bring it back.
 *
 * Implemented by suspending the `hookdeck listen` process, which is the
 * closest we can get to a severed link without root. The machine itself is
 * fine and the process is alive - only its connection to Hookdeck goes away,
 * which is what a network blip, a sleeping laptop or a flapping VPN looks
 * like. The session is not dropped, so coming back online reconnects the same
 * session rather than starting a new one.
 *
 * Contrast with the two we already had:
 *   down     clean stop, session dropped immediately
 *   crash    process gone, session held for the grace window, new session on return
 *   offline  same session, reconnects and picks up what it missed
 */
export function setLink(approach: Approach, names: string[], online: boolean): string[] {
  // Machines started before their listener pidfile existed cannot be signalled.
  // Report them rather than doing nothing quietly: from the UI a silent no-op
  // is indistinguishable from the feature not working.
  const skipped: string[] = [];
  for (const name of names) {
    const file = listenerPidFile(approach, name);
    if (!existsSync(file)) {
      console.log(`  = ${name} has no listener pidfile - restart it with \`fleet up\``);
      skipped.push(name);
      continue;
    }
    const pid = Number(readFileSync(file, "utf8").trim());
    try {
      process.kill(pid, online ? "SIGCONT" : "SIGSTOP");
    } catch {
      console.log(`  = ${name} listener ${pid} is gone`);
      rmSync(file, { force: true });
      skipped.push(name);
      continue;
    }
    appendFileSync(
      logPath(approach, name),
      `${new Date().toISOString()} ${online ? "ONLINE link restored" : "OFFLINE link lost"} listener pid ${pid}\n`,
    );
    console.log(
      online
        ? `  ~ ${name} back online - reconnects the same session`
        : `  ~ ${name} offline - link to Hookdeck is gone, the machine itself is still up`,
    );
  }
  return skipped;
}

/**
 * Stop or start a machine's CLI session while the machine keeps running.
 *
 * Stopping closes the WebSocket cleanly, so Hookdeck drops the session at once
 * and the next event records CLI_DISCONNECTED - with no grace window and no
 * event created. That is what separates this from `offline`, where the socket
 * stays open and events fail with CLI_UNAVAILABLE until the server gives up.
 */
export function setSession(approach: Approach, names: string[], connected: boolean): string[] {
  const skipped: string[] = [];
  for (const name of names) {
    const pid = readPid(approach, name);
    if (!pid || !groupAlive(pid)) {
      console.log(`  = ${name} is not running`);
      skipped.push(name);
      continue;
    }
    writeFileSync(
      resolve(runDir(), `${approach}.${name}.session`),
      connected ? "connected" : "disconnected",
    );
    // The machine picks this up on its next poll. Wait for it, so a caller
    // reading state straight afterwards sees the change rather than the state
    // it just asked to leave.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (existsSync(listenerPidFile(approach, name)) === connected) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
    appendFileSync(
      logPath(approach, name),
      `${new Date().toISOString()} ${connected ? "SESSION connect requested" : "SESSION disconnect requested"}\n`,
    );
    console.log(
      connected
        ? `  ~ ${name} starting its CLI session`
        : `  ~ ${name} stopping its CLI session - machine stays up, next event is CLI_DISCONNECTED`,
    );
  }
  return skipped;
}

function signal(approach: Approach, names: string[], sig: "SIGTERM" | "SIGKILL"): void {
  for (const name of names) {
    const pid = readPid(approach, name);
    if (!pid || !groupAlive(pid)) {
      console.log(`  = ${name} not running`);
      rmSync(pidFile(approach, name), { force: true });
      continue;
    }
    if (sig === "SIGKILL") {
      // Negative PID targets the whole process group, so the supervisor and
      // `hookdeck listen` die together with no chance to close the WebSocket.
      // Killing only the supervisor would orphan the listener, leaving the
      // session attached and quietly invalidating the scenario.
      process.kill(-pid, "SIGKILL");
    } else {
      // Only the supervisor, so it can forward SIGINT to `hookdeck listen` the
      // way Ctrl+C would. Signaling the group instead would deliver SIGTERM
      // straight to the listener, and we would no longer be demonstrating the
      // clean Ctrl+C path.
      process.kill(pid, "SIGTERM");
    }
    const kind = sig === "SIGKILL" ? "CRASH (session held for the ~2m grace window)" : "clean stop (session dropped immediately)";
    console.log(`  - ${name} pgid=${pid} ${sig} -> ${kind}`);
    if (sig === "SIGKILL") {
      appendFileSync(
        logPath(approach, name),
        `${new Date().toISOString()} CRASH SIGKILL to process group ${pid}\n`,
      );
    }

    // Wait for the group to actually be gone before declaring it stopped. If
    // we returned early and the caller restarted the machine, the old listener
    // would still hold its session and the connection would receive one event
    // per session - duplicate deliveries with no visible cause.
    if (!waitForGroupExit(pid, 12_000)) {
      console.log(`    ! ${name} pgid=${pid} still alive after 12s - sending SIGKILL to the group`);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      if (!waitForGroupExit(pid, 5_000)) {
        console.log(`    ! ${name} pgid=${pid} COULD NOT BE STOPPED - check manually before restarting`);
      }
    }
    rmSync(pidFile(approach, name), { force: true });
  }
}

export function down(approach: Approach, names: string[]): void {
  signal(approach, names, "SIGTERM");
}

const allMachines = (): string[] => machines().map((m) => m.name);

/** Clean stop. The websocket closes, so the session drops immediately. */
export function stopSessions(approaches: Approach[] = APPROACHES): void {
  for (const approach of approaches) down(approach, allMachines());
}

/**
 * Stop any listener still attached to a previous connection, then start one
 * for each machine. `up` leaves an already-running process in place, which
 * would stay subscribed to a connection this setup just replaced.
 */
export function startSessions(approaches: Approach[] = APPROACHES): void {
  for (const approach of approaches) {
    const names = allMachines();
    down(approach, names);
    up(approach, names);
  }
}

export function crash(approach: Approach, names: string[]): void {
  signal(approach, names, "SIGKILL");
}

export function status(
  approaches: Approach[],
  opts: { quiet?: boolean } = {},
): { approach: Approach; machines: MachineStatus[] }[] {
  const rows = approaches.map((approach) => ({
    approach,
    machines: machines().map((m): MachineStatus => {
      const pid = readPid(approach, m.name);
      const alive = pid !== undefined && groupAlive(pid);
      return {
        name: m.name,
        group: groupOf(m.name).name,
        up: alive,
        offline: alive && listenerSuspended(approach, m.name),
        listening: alive && existsSync(listenerPidFile(approach, m.name)),
        port: portOf(approach, m.name),
        connection: connectionName(approach, m.name),
        pid: alive ? pid : undefined,
      };
    }),
  }));

  if (!opts.quiet) {
    for (const row of rows) {
      console.log(`\n${row.approach}`);
      for (const m of row.machines) {
        const state = !m.up
          ? "down   "
          : !m.listening
            ? "no-sess"
            : m.offline
              ? "offline"
              : "up     ";
        console.log(
          `  ${state} ${m.name.padEnd(16)} port=${String(m.port).padEnd(5)} ` +
            `connection=${m.connection.padEnd(28)} ${m.up ? `pgid=${m.pid}` : ""}`,
        );
      }
    }
    console.log("");
  }
  return rows;
}

function main(): void {
  const [command, ...rest] = applyScenarioArg(process.argv.slice(2));

  if (command === "status") {
    const approach = rest[0] as Approach | undefined;
    status(approach ? [approach] : APPROACHES);
    return;
  }

  if (command === "logs") {
    const [approach, name] = rest as [Approach, string];
    if (!approach || !name) throw new Error("usage: fleet logs <approach> <machine>");
    spawn("tail", ["-f", logPath(approach, name)], { stdio: "inherit" });
    return;
  }

  const approach = rest[0] as Approach;
  if (!APPROACHES.includes(approach)) {
    console.error(
      `usage: npm run fleet -- <up|down|crash|offline|online|connect|disconnect> <per-machine|per-group> [machine...]\n` +
        `       npm run fleet -- status [approach]\n` +
        `       npm run fleet -- logs <approach> <machine>`,
    );
    process.exit(2);
  }
  const names = resolveTargets(rest.slice(1));

  switch (command) {
    case "up":
      console.log(`Starting ${names.length} machine(s) for ${approach}:`);
      up(approach, names);
      break;
    case "down":
      console.log(`Stopping ${names.length} machine(s) for ${approach}:`);
      down(approach, names);
      break;
    case "crash":
      console.log(`Crashing ${names.length} machine(s) for ${approach}:`);
      crash(approach, names);
      break;
    case "offline":
      console.log(`Taking ${names.length} machine(s) offline on ${approach}:`);
      setLink(approach, names, false);
      break;
    case "online":
      console.log(`Bringing ${names.length} machine(s) back online on ${approach}:`);
      setLink(approach, names, true);
      break;
    case "disconnect":
      console.log(`Stopping the CLI session on ${names.length} machine(s) for ${approach}:`);
      setSession(approach, names, false);
      break;
    case "connect":
      console.log(`Starting the CLI session on ${names.length} machine(s) for ${approach}:`);
      setSession(approach, names, true);
      break;
    default:
      console.error(`Unknown command ${command}`);
      process.exit(2);
  }
}

function launchedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (launchedAsCli()) {
  try {
    main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
