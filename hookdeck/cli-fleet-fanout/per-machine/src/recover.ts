/**
 * Approach 1 recovery: replay only the events one machine missed, to only that
 * machine.
 *
 *   npm run recover -- group-a-host-01
 *   npm run recover -- group-a-host-01 --since 2026-09-23T10:00:00Z
 *   npm run recover -- group-a-host-01 --dry-run
 *
 * How it works:
 *
 *   1. List the source's requests since a time bound. The request list cannot
 *      be filtered by ignored-event cause or by connection, so the bound is
 *      what keeps this cheap.
 *   2. For each request, fetch its ignored events and keep the ones with cause
 *      CLI_DISCONNECTED on this machine's connection. That record only exists
 *      because the machine has a connection of its own - it is what approach 2
 *      cannot give you.
 *   3. Skip any request that already has an event on this connection, so a
 *      re-run does not deliver the same webhook twice.
 *   4. Retry each remaining request with webhook_ids set to just this
 *      machine's connection, so no other machine sees a duplicate.
 *
 * State: the last successful run is recorded in run/recover.<machine>.json and
 * used as the default --since on the next run.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { connectionName, runDir } from "../../shared/src/config.js";
import {
  listEventsForRequest,
  listIgnoredEventsForRequest,
  listRequests,
  retryEvent,
  retryRequest,
  type HookdeckRequest,
} from "../../shared/src/hookdeck.js";

const CAUSE = "CLI_DISCONNECTED";

async function readApi<T>(fn: () => Promise<T>): Promise<T> {
  let delay = 500;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("429") || attempt >= 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

/**
 * A machine that was down can miss events in two different ways, and they need
 * different recovery. Which one you get depends only on how long it was gone.
 *
 *   Inside the ~2 minute reconnect grace window, the session is still
 *   registered, so an event IS created and delivery fails. The event exists,
 *   with status FAILED. It does not retry itself. Recover it by retrying the
 *   event.
 *
 *   Past the window, no session is registered, so no event is created at all.
 *   An ignored event is recorded against the connection with cause
 *   CLI_DISCONNECTED. There is nothing to retry, so recovery goes back to the
 *   request, scoped to this connection.
 *
 * Looking only for ignored events - which this script used to do - silently
 * misses everything in the first category.
 */

interface SetupState {
  sources: Record<string, { id: string; name: string; url: string }>;
  connections: Record<string, { id: string; name: string; approach: string }>;
}

const setupState = (): SetupState => {
  try {
    return JSON.parse(readFileSync(resolve(runDir(), "setup.json"), "utf8")) as SetupState;
  } catch {
    throw new Error("run/setup.json not found. Run `npm run setup` first.");
  }
};

const statePath = (machineName: string): string =>
  resolve(runDir(), `recover.${machineName}.json`);

function defaultSince(machineName: string): string {
  try {
    const state = JSON.parse(readFileSync(statePath(machineName), "utf8")) as { lastRunAt?: string };
    if (state.lastRunAt) return state.lastRunAt;
  } catch {
    /* first run */
  }
  // No prior run: a conservative default rather than the whole retention window.
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

export interface RecoverResult {
  missed: string[];
  failedEvents: string[];
}

/**
 * Replay what this machine missed onto its own connection. Safe to call when
 * the machine has just attached: requests that already have a successful event
 * on this connection are skipped, so a second run does not duplicate them.
 */
export async function recoverMachine(
  machineName: string,
  opts: { since?: string; dryRun?: boolean; force?: boolean } = {},
): Promise<RecoverResult> {
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const since = opts.since ?? defaultSince(machineName);
  const state = setupState();
  const connName = connectionName("per-machine", machineName);
  const connection = state.connections[connName];
  const source = state.sources["per-machine"];
  if (!connection) throw new Error(`No connection id for ${connName} in run/setup.json.`);
  if (!source) throw new Error("No per-machine source in run/setup.json.");

  const startedAt = new Date().toISOString();
  console.log(`Recovering ${machineName}`);
  console.log(`  connection ${connName} (${connection.id})`);
  console.log(`  source     ${source.name} (${source.id})`);
  console.log(`  since      ${since}${opts.since ? "" : " (from last run)"}\n`);

  const requests: HookdeckRequest[] = (
    await listRequests({ source_id: source.id, created_at_gte: since, limit: 250, dir: "asc" })
  ).models;
  console.log(`  ${requests.length} request(s) in window\n`);

  const missed: string[] = [];          // no event was ever created
  const failedEvents: string[] = [];    // event exists but delivery failed
  const alreadyDelivered: string[] = [];
  let skipped = 0;

  for (const request of requests) {
    let events;
    try {
      events = (await readApi(() => listEventsForRequest(request.id))).models.filter(
        (e) => e.webhook_id === connection.id,
      );
    } catch (err) {
      skipped += 1;
      console.log(`  skipped ${request.id}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Case 1: an event exists for this connection. If it failed, retry the
    // event itself rather than the request - retrying the request would create
    // a second event alongside the failed one.
    if (events.length > 0) {
      const failed = events.filter((e) => e.status !== "SUCCESSFUL");
      if (failed.length > 0) {
        for (const e of failed) failedEvents.push(e.id);
      } else if (!force) {
        // Already delivered. Skipping is what makes a re-run safe.
        alreadyDelivered.push(request.id);
      }
      continue;
    }

    // Case 2: no event for this connection. Only our own cause counts - a
    // FILTERED ignored event means the connection correctly did not want it.
    let ignored;
    try {
      ignored = (await readApi(() => listIgnoredEventsForRequest(request.id))).models.filter(
        (e) => e.webhook_id === connection.id && e.cause === CAUSE,
      );
    } catch (err) {
      skipped += 1;
      console.log(`  skipped ${request.id}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (ignored.length > 0) missed.push(request.id);
  }

  if (skipped > 0) {
    console.log(`  ${skipped} request(s) skipped after repeated rate limits`);
  }

  console.log(`  ${missed.length} request(s) never created an event (${CAUSE})`);
  console.log(`  ${failedEvents.length} event(s) created but failed (e.g. CLI_UNAVAILABLE)`);
  if (alreadyDelivered.length > 0) {
    console.log(
      `  ${alreadyDelivered.length} skipped: already has an event on this connection ` +
        `(use --force to retry anyway)`,
    );
  }

  if (missed.length === 0 && failedEvents.length === 0) {
    console.log("\nNothing to recover.");
    return { missed, failedEvents };
  } else if (dryRun) {
    console.log("\nDry run. Would run:");
    for (const id of missed) {
      console.log(`  hookdeck gateway request retry ${id} --connection-ids ${connection.id}`);
    }
    for (const id of failedEvents) {
      console.log(`  POST /events/${id}/retry`);
    }
  } else {
    console.log("");
    for (const id of failedEvents) {
      const e = await retryEvent(id);
      console.log(`  retried event   ${id} -> status ${e.status ?? "?"}`);
    }
    for (const id of missed) {
      const result = await retryRequest(id, [connection.id]);
      const created = (result.events ?? []).map((e) => e.id).join(", ");
      console.log(`  retried request ${id} -> event(s) ${created || "(none reported)"}`);
    }
    if (skipped === 0) {
      mkdirSync(runDir(), { recursive: true });
      writeFileSync(
        statePath(machineName),
        `${JSON.stringify({ machine: machineName, lastRunAt: startedAt, recovered: missed, retriedEvents: failedEvents }, null, 2)}\n`,
      );
    }
    console.log(
      `\nRecovered ${missed.length + failedEvents.length} event(s) for ${machineName} only ` +
        `(${failedEvents.length} failed event(s), ${missed.length} never created).`,
    );
    console.log(
      skipped === 0
        ? `Watermark written to run/recover.${machineName}.json`
        : "Watermark left unchanged because some requests could not be read.",
    );
  }
  return { missed, failedEvents };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  const machineName = positionals[0];
  if (!machineName) {
    console.error("usage: npm run recover -- <machine-name> [--since <iso>] [--dry-run] [--force]");
    process.exit(2);
  }
  await recoverMachine(machineName, {
    since: values.since,
    dryRun: values["dry-run"],
    force: values.force,
  });
}

function launchedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (launchedAsCli()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
