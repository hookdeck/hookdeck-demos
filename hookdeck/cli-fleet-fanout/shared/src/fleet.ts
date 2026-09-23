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
import { spawn } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { ROOT, logPath, machines, portOf, connectionName, runDir, type Approach } from "./config.js";
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

function up(approach: Approach, names: string[]): void {
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

function status(approaches: Approach[]): void {
  for (const approach of approaches) {
    console.log(`\n${approach}`);
    for (const m of machines()) {
      const pid = readPid(approach, m.name);
      const alive = pid !== undefined && groupAlive(pid);
      console.log(
        `  ${alive ? "up  " : "down"} ${m.name.padEnd(12)} port=${String(portOf(approach, m.name)).padEnd(5)} ` +
          `connection=${connectionName(approach, m.name).padEnd(28)} ${alive ? `pgid=${pid}` : ""}`,
      );
    }
  }
  console.log("");
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

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
      `usage: npm run fleet -- <up|down|crash> <per-machine|per-group> [machine...]\n` +
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
      signal(approach, names, "SIGTERM");
      break;
    case "crash":
      console.log(`Crashing ${names.length} machine(s) for ${approach}:`);
      signal(approach, names, "SIGKILL");
      break;
    default:
      console.error(`Unknown command ${command}`);
      process.exit(2);
  }
}

main();
