/**
 * One simulated machine.
 *
 * A machine is a supervisor process that owns two things:
 *
 *   1. A local HTTP server on the machine's port, standing in for the CI
 *      server. It serves POST at the connection's destination path and records
 *      every delivery.
 *   2. A `hookdeck listen` child process forwarding that connection's events
 *      to the local server.
 *
 * The supervisor is spawned into its own process group by fleet.ts, which is
 * what makes the shutdown semantics demonstrable:
 *
 *   SIGTERM to the group -> we forward SIGINT to `hookdeck listen`, it sends a
 *     WebSocket 1000 close, and Hookdeck drops the session immediately.
 *   SIGKILL to the group -> the listener dies without a close frame, so the
 *     session is held open for the reconnect grace window (~2 minutes).
 *
 * Both processes have to die together for the crash case to be a real crash.
 * Killing only the supervisor would orphan the listener, which would keep the
 * session attached and quietly invalidate the scenario.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  connectionFor,
  connectionName,
  eventLogPath,
  logPath,
  portOf,
  sourceName,
  type Approach,
  runDir,
} from "./config.js";
import { ciLogin, hookdeckBin, listenerConfigPath } from "./hookdeck.js";
import { recoverMachine } from "../../per-machine/src/recover.js";
import { ensureMachineConnection } from "../../per-machine/src/ensure-connection.js";

const [rawApproach, rawName] = process.argv.slice(2);
if (!rawApproach || !rawName) {
  console.error("usage: machine.ts <per-machine|per-group> <machine-name>");
  process.exit(2);
}
// Re-bound after the guard so the narrowing survives into the functions below.
const approach: Approach = rawApproach as Approach;
const name: string = rawName;

const port = portOf(approach, name);
const connection = connectionName(approach, name);
const cliPath = connectionFor(approach, name).destination.path;
const source = sourceName(approach);
const humanLog = logPath(approach, name);
const listenerPidFile = resolve(runDir(), `${approach}.${name}.listener.pid`);
const sessionFile = resolve(runDir(), `${approach}.${name}.session`);
const jsonLog = eventLogPath(approach, name);

mkdirSync(dirname(humanLog), { recursive: true });

const ts = (): string => new Date().toISOString();

function log(line: string): void {
  const entry = `${ts()} ${line}\n`;
  appendFileSync(humanLog, entry);
  // When fleet.ts spawns us, stdout is already redirected to this same log
  // file, so echoing as well would double every line. Only echo when we are
  // attached to a terminal, i.e. someone ran machine.ts directly.
  if (process.stdout.isTTY) process.stdout.write(entry);
}

// ---------------------------------------------------------------------------
// Stand-in for the service running on the machine
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    const headers = req.headers as Record<string, string | undefined>;

    // Verify the provider signature over the raw forwarded bytes, exactly as
    // the real service would. This is what proves Hookdeck forwards the
    // original body and X-Hub-Signature-256 intact: if either were altered in
    // transit, this check would fail.
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const sent = headers["x-hub-signature-256"];
    let signature: "ok" | "BAD" | "absent" = "absent";
    if (secret && sent) {
      const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
      const a = Buffer.from(expected);
      const b = Buffer.from(sent);
      signature = a.length === b.length && timingSafeEqual(a, b) ? "ok" : "BAD";
    }
    let repo = "(unparsed)";
    try {
      repo = (JSON.parse(raw.toString("utf8")) as { repository?: { full_name?: string } })
        .repository?.full_name ?? "(no repo)";
    } catch {
      /* keep the placeholder; we still want the delivery recorded */
    }

    const record = {
      ts: ts(),
      machine: name,
      approach,
      connection,
      path: req.url,
      eventId: headers["x-hookdeck-eventid"] ?? null,
      attemptId: headers["x-hookdeck-attempt-id"] ?? null,
      delivery: headers["x-github-delivery"] ?? null,
      githubEvent: headers["x-github-event"] ?? null,
      signature: headers["x-hub-signature-256"] ?? null,
      signatureCheck: signature,
      hookdeckVerified: headers["x-hookdeck-verified"] ?? null,
      repo,
      bodyBytes: raw.length,
      // Lets the forwarded request be compared byte for byte against what was
      // originally sent.
      bodySha256: createHash("sha256").update(raw).digest("hex"),
      headers,
    };

    appendFileSync(jsonLog, `${JSON.stringify(record)}\n`);

    log(
      `RECV ${record.githubEvent ?? "?"} repo=${repo} delivery=${record.delivery ?? "?"} ` +
        `event=${record.eventId ?? "?"} bytes=${raw.length} sig=${signature}`,
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, machine: name }));
  });
});

// ---------------------------------------------------------------------------
// hookdeck listen
// ---------------------------------------------------------------------------

let listener: ChildProcess | undefined;

function startListener(): void {
  // A fresh CLI client for this listener. The event id includes the client, so
  // sessions that share one client collapse into a single delivery.
  const configPath = listenerConfigPath(approach, name);
  ciLogin(configPath);

  const args = [
    "listen",
    String(port),
    source,
    // Always the exact connection name. A path-like argument would match every
    // connection whose CLI path contains it.
    connection,
    // Without a terminal the CLI falls back to compact output anyway; being
    // explicit keeps the logs stable.
    "--output",
    "compact",
    // Distinct device name per machine, so sessions are distinguishable in
    // whatever session information the CLI does surface.
    "--device-name",
    name,
  ];
  log(`EXEC hookdeck ${args.join(" ")}`);

  const child = spawn(hookdeckBin(), [...args, "--hookdeck-config", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  listener = child;

  const pipe = (prefix: string) => (buf: Buffer) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      log(`${prefix} ${line.trimEnd()}`);
      if (prefix === "LISTEN") maybeRecover(line);
    }
  };
  child.stdout?.on("data", pipe("LISTEN"));
  child.stderr?.on("data", pipe("LISTEN"));

  // Record the listener's own pid. `fleet pause` freezes just this process, so
  // the machine stays up and only its link to Hookdeck goes away - a network
  // problem rather than a crash.
  try {
    writeFileSync(listenerPidFile, String(child.pid));
  } catch {
    /* best effort: pause is a convenience, not required for the demo to run */
  }

  child.on("exit", (code, signal) => {
    rmSync(listenerPidFile, { force: true });
    listener = undefined;
    log(`LISTEN exited code=${code} signal=${signal}`);
    if (shuttingDown) return;
    if (!listenerWanted) {
      // Stopped on purpose: the machine stays up with no CLI session, which is
      // what produces CLI_DISCONNECTED on the next event.
      log("SESSION disconnected - machine still up, no CLI session");
      return;
    }
    process.exit(code ?? 1);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let shuttingDown = false;
/**
 * Whether this machine is supposed to have a listener. Stopping the listener
 * on purpose must not take the machine down with it, so the exit handler
 * checks this before deciding an exit was a failure.
 */
let listenerWanted = true;
let recovering = false;

/**
 * Approach 1 records a miss against this machine's own connection, so once the
 * session is up we can retry just that connection. Approach 2 has nothing to
 * aim at: a retry on the group connection would also deliver to every peer
 * that is already attached.
 */
function maybeRecover(line: string): void {
  if (approach !== "per-machine" || shuttingDown) return;
  if (!line.includes("Connected. Waiting for events")) return;
  if (recovering) {
    // Say so rather than skipping quietly. A recovery that never settles used
    // to leave this flag set, which disabled recovery for the life of the
    // process without a word in the log.
    log("RECOVER skipped: a previous recovery is still running");
    return;
  }
  recovering = true;
  // Belt and braces: whatever happens to the promise, allow the next
  // reconnect to try again.
  const release = setTimeout(() => {
    if (!recovering) return;
    log("RECOVER timed out after 60s - allowing the next reconnect to retry");
    recovering = false;
  }, 60_000);
  release.unref();
  // The "Connected" line is local. Give the session a moment to register
  // before asking Hookdeck to deliver what this connection missed.
  setTimeout(() => {
    recoverMachine(name)
      .catch((err: unknown) => {
        log(`RECOVER failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        clearTimeout(release);
        recovering = false;
      });
  }, 2000).unref();
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`SHUTDOWN clean (${signal}) - sending SIGINT to hookdeck listen`);
  // SIGINT is what Ctrl+C sends. The CLI closes the WebSocket with code 1000
  // and Hookdeck drops the session straight away rather than holding it.
  // SIGCONT first, in case the machine is offline: a suspended process would
  // never see the SIGINT and we would escalate to SIGKILL for no reason.
  listener?.kill("SIGCONT");
  listener?.kill("SIGINT");

  const done = () => {
    server.close();
    process.exit(0);
  };

  if (!listener) {
    done();
    return;
  }

  const child = listener;
  child.once("exit", done);

  // Never exit while the listener might still be alive. An orphaned listener
  // keeps its session attached, and Hookdeck creates one event per attached
  // session - so a leaked listener silently doubles delivery to this machine
  // and there is nothing in the logs to say why. Escalate rather than assume.
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      log("SHUTDOWN listener did not exit on SIGINT after 5s - escalating to SIGKILL");
      child.kill("SIGKILL");
      setTimeout(done, 1000).unref();
    }
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * Session control, driven by `fleet disconnect` and `fleet connect`.
 *
 * Stopping `hookdeck listen` the way Ctrl+C would closes the WebSocket
 * cleanly, so Hookdeck drops the session immediately and the next event
 * records CLI_DISCONNECTED. The machine and its local service keep running,
 * which is what separates this from `down`.
 *
 * Driven by a file rather than a signal: this process is started through the
 * tsx CLI, which forwards SIGTERM but not SIGUSR1/SIGUSR2, so a user signal
 * sent to the pid we record never arrives here.
 */
function readSessionWish(): boolean {
  try {
    return readFileSync(sessionFile, "utf8").trim() !== "disconnected";
  } catch {
    return true; // no file means connected, which is the default
  }
}

setInterval(() => {
  if (shuttingDown) return;
  const wanted = readSessionWish();
  if (wanted === listenerWanted) return;
  listenerWanted = wanted;
  if (!wanted) {
    log("SESSION stopping hookdeck listen (clean close)");
    // A suspended process cannot act on SIGINT - the signal just queues. Thaw
    // it first so that stopping an offline machine's session still closes the
    // WebSocket cleanly rather than timing out into a SIGKILL.
    listener?.kill("SIGCONT");
    listener?.kill("SIGINT");
  } else {
    log("SESSION starting hookdeck listen");
    startListener();
  }
}, 500).unref();

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log(`FATAL port ${port} is already in use - a previous ${name} is still running. ` +
        `Run \`npm run fleet -- down ${approach} ${name}\` first.`);
  } else {
    log(`FATAL ${err.message}`);
  }
  listener?.kill("SIGKILL");
  process.exit(1);
});

/**
 * Self-registration, opt-in with FLEET_SELF_REGISTER=1.
 *
 * In production a machine does not wait for anyone to provision it: at launch
 * it ensures its own connection exists, then starts listening. `connection
 * upsert` is idempotent, so this is safe on every boot and on a redeploy, and
 * it is the same call `npm run setup` makes for the whole fleet at once -
 * central provisioning is this, run from one place.
 *
 * It fails closed. If the upsert fails we must not start `listen`, because
 * `listen` creates a connection called `cli-<source>` when it finds none for
 * the source, and every machine would then attach to that one - silently
 * collapsing one connection per machine into one per group, which is the exact
 * thing this demo argues against.
 *
 * Only for per-machine. Under one connection per group, N machines would race
 * to own one shared connection: idempotent, so it would not error, but a
 * machine booting from a stale config would quietly rewrite the filter for the
 * whole group. Those machines rely on central provisioning instead.
 */
async function selfRegister(): Promise<void> {
  if (process.env.FLEET_SELF_REGISTER !== "1") return;
  if (approach !== "per-machine") {
    log(`REGISTER skipped: ${approach} connections are provisioned centrally`);
    return;
  }
  log(`REGISTER ensuring ${connection} exists before listening`);
  try {
    await ensureMachineConnection(name, { quiet: true });
    log(`REGISTER ${connection} ready`);
  } catch (err: unknown) {
    log(`FATAL could not ensure ${connection}: ${err instanceof Error ? err.message : err}`);
    log("FATAL refusing to listen without its own connection");
    process.exit(1);
  }
}

async function start(): Promise<void> {
  await selfRegister();
  server.listen(port, "127.0.0.1", () => {
    log(
      `READY machine=${name} approach=${approach} port=${port} connection=${connection} ` +
        `source=${source} path=${cliPath}`,
    );
    startListener();
  });
}

void start();
