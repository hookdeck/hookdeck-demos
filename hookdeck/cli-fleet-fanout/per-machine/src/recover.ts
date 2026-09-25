/**
 * Replay what one machine missed, onto that machine only.
 *
 *   npm run recover -- group-a-host-01
 *   npm run recover -- group-a-host-01 --since 2026-09-23T10:00:00Z --dry-run
 *
 * A machine that was down misses events in one of two ways, and which one
 * depends only on how long it was gone:
 *
 *   Inside the ~2 minute reconnect grace window the session is still
 *   registered, so an event IS created and delivery fails. Retry the event.
 *
 *   Past the window nothing is listening, so no event is created at all - the
 *   request records an ignored event with cause CLI_DISCONNECTED. There is
 *   nothing to retry, so go back to the request and retry it scoped to this
 *   connection.
 *
 * Both are possible because the machine has a connection of its own. That is
 * what one connection per group cannot give you.
 *
 * `machine.ts` calls this when a machine's CLI session reconnects. The last run
 * is recorded in run/recover.<machine>.json and used as the next --since.
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
} from "../../shared/src/hookdeck.js";

const CAUSE = "CLI_DISCONNECTED";

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

const statePath = (machineName: string): string => resolve(runDir(), `recover.${machineName}.json`);

function defaultSince(machineName: string): string {
  try {
    const state = JSON.parse(readFileSync(statePath(machineName), "utf8")) as { lastRunAt?: string };
    if (state.lastRunAt) return state.lastRunAt;
  } catch {
    /* first run: a conservative window rather than the whole retention period */
  }
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

export interface RecoverResult {
  /** Requests where no event was created for this connection. */
  missed: string[];
  /** Events that exist for this connection but failed to deliver. */
  failedEvents: string[];
}

export async function recoverMachine(
  machineName: string,
  opts: { since?: string; dryRun?: boolean } = {},
): Promise<RecoverResult> {
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
  console.log(`  since      ${since}${opts.since ? "" : " (from last run)"}`);

  const requests = (
    await listRequests({ source_id: source.id, created_at_gte: since, limit: 250, dir: "asc" })
  ).models;

  const missed: string[] = [];
  const failedEvents: string[] = [];
  let alreadyDelivered = 0;

  for (const request of requests) {
    const events = (await listEventsForRequest(request.id)).models.filter(
      (e) => e.webhook_id === connection.id,
    );

    if (events.length > 0) {
      // An event exists, so retry the event rather than the request - retrying
      // the request would create a second event alongside the failed one.
      const failed = events.filter((e) => e.status !== "SUCCESSFUL");
      if (failed.length > 0) failedEvents.push(...failed.map((e) => e.id));
      else alreadyDelivered += 1; // skipping these is what makes a re-run safe
      continue;
    }

    // No event. Only our own cause counts: a FILTERED ignored event means the
    // connection correctly did not want this request.
    const ignored = (await listIgnoredEventsForRequest(request.id)).models;
    if (ignored.some((e) => e.webhook_id === connection.id && e.cause === CAUSE)) {
      missed.push(request.id);
    }
  }

  console.log(
    `  ${requests.length} request(s) in window: ${failedEvents.length} failed event(s), ` +
      `${missed.length} never created, ${alreadyDelivered} already delivered\n`,
  );

  if (missed.length === 0 && failedEvents.length === 0) {
    console.log("Nothing to recover.");
    return { missed, failedEvents };
  }

  if (opts.dryRun) {
    console.log("Dry run. Would run:");
    for (const id of failedEvents) console.log(`  POST /events/${id}/retry`);
    for (const id of missed) {
      console.log(`  POST /requests/${id}/retry webhook_ids=${connection.id}`);
    }
    return { missed, failedEvents };
  }

  for (const id of failedEvents) {
    const event = await retryEvent(id);
    console.log(`  retried event   ${id} -> ${event.status ?? "?"}`);
  }
  for (const id of missed) {
    const result = await retryRequest(id, [connection.id]);
    console.log(`  retried request ${id} -> ${(result.events ?? []).length} event(s)`);
  }

  mkdirSync(runDir(), { recursive: true });
  writeFileSync(
    statePath(machineName),
    `${JSON.stringify({ machine: machineName, lastRunAt: startedAt, missed, failedEvents }, null, 2)}\n`,
  );

  console.log(
    `\nRecovered ${missed.length + failedEvents.length} event(s) for ${machineName} only.`,
  );
  return { missed, failedEvents };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { since: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  const machineName = positionals[0];
  if (!machineName) {
    console.error("usage: npm run recover -- <machine-name> [--since <iso>] [--dry-run]");
    process.exit(2);
  }
  await recoverMachine(machineName, { since: values.since, dryRun: values["dry-run"] });
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
