/**
 * One simulated machine.
 *
 * A machine is a supervisor process that owns two things:
 *
 *   1. A local HTTP server on the machine's port, standing in for the CI
 *      server. It serves POST <cliPath> and records every delivery.
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
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  connectionName,
  eventLogPath,
  fleet,
  logPath,
  portOf,
  sourceName,
  type Approach,
} from "./config.js";
import { configFlag, hookdeckBin } from "./hookdeck.js";

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
const source = sourceName(approach);
const humanLog = logPath(approach, name);
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
      // originally sent. See the signature question in FINDINGS.md.
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

  // configFlag keeps the demo's CLI credentials out of ~/.config/hookdeck.
  const child = spawn(hookdeckBin(), [...args, ...configFlag()], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  listener = child;

  const pipe = (prefix: string) => (buf: Buffer) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.trim()) log(`${prefix} ${line.trimEnd()}`);
    }
  };
  child.stdout?.on("data", pipe("LISTEN"));
  child.stderr?.on("data", pipe("LISTEN"));

  child.on("exit", (code, signal) => {
    log(`LISTEN exited code=${code} signal=${signal}`);
    if (!shuttingDown) process.exit(code ?? 1);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`SHUTDOWN clean (${signal}) - sending SIGINT to hookdeck listen`);
  // SIGINT is what Ctrl+C sends. The CLI closes the WebSocket with code 1000
  // and Hookdeck drops the session straight away rather than holding it.
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

server.listen(port, "127.0.0.1", () => {
  log(
    `READY machine=${name} approach=${approach} port=${port} connection=${connection} ` +
      `source=${source} path=${fleet().cliPath}`,
  );
  startListener();
});
