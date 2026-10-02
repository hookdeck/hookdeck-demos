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
 * Either way, only a *settled* event is ours to retry. Recovery runs the moment
 * a session reconnects, which can land while Hookdeck still has an attempt
 * queued or a retry scheduled, and `POST /events/{id}/retry` has no guard on
 * status: it publishes the event for delivery immediately and leaves
 * `next_attempt_at` alone, so the scheduled retry stays armed and fires too.
 * That is a duplicate delivery, caused by the recovery meant to prevent a miss.
 * So wait for the event to settle, and retry only if it settled as FAILED.
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
  getEvent,
  isSettled,
  listEventsForRequest,
  listIgnoredEventsForRequest,
  listRequests,
  retryEvent,
  retryRequest,
  type HookdeckEvent,
} from "../../shared/src/hookdeck.js";

const CAUSE = "CLI_DISCONNECTED";

/**
 * How long to let an unsettled event finish before deciding about it, and how
 * often to look. Recovery runs the moment a session reconnects, which can land
 * while Hookdeck still has an attempt queued or a retry scheduled for the same
 * event - and retrying one of those delivers it twice. So wait for it to
 * settle instead, then retry only if it actually failed.
 *
 * The CLI retry budget is about 10 seconds (MAX_CLI_RETRIES 5 at
 * CLI_RETRY_DELAY 2s), so this is a generous ceiling rather than a guess.
 */
const SETTLE_TIMEOUT_MS = 30_000;
const SETTLE_POLL_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll one event until it settles, or give up.
 *
 * Giving up is not a failure: the event is still Hookdeck's to deliver, and
 * the next run picks it up. Forcing a retry is the only thing that could
 * duplicate, so when in doubt, do nothing.
 */
async function waitForSettled(event: HookdeckEvent): Promise<HookdeckEvent> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let current = event;
  while (!isSettled(current) && Date.now() < deadline) {
    await sleep(SETTLE_POLL_MS);
    current = await getEvent(current.id);
  }
  return current;
}

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
  /** Events that exist for this connection and settled as FAILED. */
  failedEvents: string[];
  /**
   * Events still in flight when we gave up waiting. Deliberately not retried -
   * Hookdeck will finish them, and a retry now would duplicate.
   */
  unsettled: string[];
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
  const unsettled: string[] = [];
  let alreadyDelivered = 0;

  for (const request of requests) {
    const events = (await listEventsForRequest(request.id)).models.filter(
      (e) => e.webhook_id === connection.id,
    );

    if (events.length > 0) {
      // An event exists, so retry the event rather than the request - retrying
      // the request would create a second event alongside the failed one.
      //
      // Only a settled event is ours to retry. Anything still queued, scheduled
      // or held is Hookdeck's to finish, and retrying it would deliver it twice.
      for (const event of events) {
        const settled = await waitForSettled(event);
        if (!isSettled(settled)) unsettled.push(settled.id);
        else if (settled.status === "FAILED") failedEvents.push(settled.id);
        else alreadyDelivered += 1; // skipping these is what makes a re-run safe
      }
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
      `${missed.length} never created, ${alreadyDelivered} already delivered` +
      (unsettled.length > 0 ? `, ${unsettled.length} still in flight (left alone)` : "") +
      "\n",
  );
  for (const id of unsettled) {
    console.log(`  in flight ${id} - Hookdeck is still delivering it, leaving it alone`);
  }

  if (missed.length === 0 && failedEvents.length === 0) {
    console.log("Nothing to recover.");
    return { missed, failedEvents, unsettled };
  }

  if (opts.dryRun) {
    console.log("Dry run. Would run:");
    for (const id of failedEvents) console.log(`  POST /events/${id}/retry`);
    for (const id of missed) {
      console.log(`  POST /requests/${id}/retry webhook_ids=${connection.id}`);
    }
    return { missed, failedEvents, unsettled };
  }

  for (const id of failedEvents) {
    const event = await retryEvent(id);
    console.log(`  retried event   ${id} -> ${event.status ?? "?"}`);
  }
  for (const id of missed) {
    const result = await retryRequest(id, [connection.id]);
    console.log(`  retried request ${id} -> ${(result.events ?? []).length} event(s)`);
  }

  // Only advance the watermark if nothing was left in flight. `since` filters
  // requests by creation time, so moving it to now would put an unsettled
  // event's request behind the window and the next run would never see it.
  const lastRunAt = unsettled.length === 0 ? startedAt : since;
  mkdirSync(runDir(), { recursive: true });
  writeFileSync(
    statePath(machineName),
    `${JSON.stringify({ machine: machineName, lastRunAt, missed, failedEvents, unsettled }, null, 2)}\n`,
  );

  console.log(
    `\nRecovered ${missed.length + failedEvents.length} event(s) for ${machineName} only.`,
  );
  return { missed, failedEvents, unsettled };
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
