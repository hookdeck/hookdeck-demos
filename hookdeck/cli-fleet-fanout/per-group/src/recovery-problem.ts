/**
 * Approach 2: demonstrate why recovery does not work, rather than paper over it.
 *
 *   npm run group-recovery-problem -- group-a
 *
 * Preconditions: one machine in the group has been down and has missed events,
 * and is now back up alongside its peers.
 *
 * What this shows:
 *
 *   1. Hookdeck has one connection for the whole group, so when some machines
 *      in the group were connected and one was not, the request records a
 *      normal delivered event. Nothing anywhere says a machine missed it. The
 *      miss is only visible by diffing the machines' own logs, which Hookdeck
 *      cannot do for you.
 *   2. The only lever is a retry on the group connection, and a retry creates
 *      one event per session attached at that moment. The machines that
 *      already had the event get it again.
 *
 * This script does not fix that. It counts the divergence between machines,
 * then, with --retry, performs the retry and counts the duplicates it causes.
 */
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  eventLogPath,
  group,
  groupConnectionName,
  runDir,
} from "../../shared/src/config.js";
import { ciLogin, listRequests, retryRequest } from "../../shared/src/hookdeck.js";
import { resolve } from "node:path";

interface SetupState {
  sources: Record<string, { id: string; name: string; url: string }>;
  connections: Record<string, { id: string; name: string; approach: string }>;
}

const setupState = (): SetupState =>
  JSON.parse(readFileSync(resolve(runDir(), "setup.json"), "utf8")) as SetupState;

interface Received {
  delivery: string | null;
  eventId: string | null;
  ts: string;
}

function received(machineName: string): Received[] {
  const path = eventLogPath("per-group", machineName);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Received);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { retry: { type: "boolean", default: false }, since: { type: "string" } },
  });
  const groupName = positionals[0] ?? "group-a";
  const spec = group(groupName);
  const connName = groupConnectionName(groupName);

  ciLogin();
  const state = setupState();
  const connection = state.connections[connName];
  const source = state.sources["per-group"];
  if (!connection || !source) throw new Error("Run `npm run setup` first.");

  // 1. What each machine actually got, from its own log. Hookdeck cannot tell
  //    us this, which is the point.
  console.log(`\nWhat each machine in ${groupName} received (from its own log):\n`);
  const byMachine = new Map<string, Set<string>>();
  for (const name of spec.hosts) {
    const deliveries = new Set(received(name).map((r) => r.delivery ?? "?"));
    byMachine.set(name, deliveries);
    console.log(`  ${name.padEnd(14)} ${deliveries.size} delivery/deliveries`);
  }

  const union = new Set([...byMachine.values()].flatMap((s) => [...s]));
  const behind = [...byMachine.entries()]
    .map(([name, got]) => ({ name, missing: [...union].filter((d) => !got.has(d)) }))
    .filter((m) => m.missing.length > 0);

  console.log(`\n  ${union.size} distinct delivery/deliveries seen by the group as a whole`);
  if (behind.length === 0) {
    console.log("  No machine is behind. Take one down, send webhooks, bring it back, re-run.\n");
  } else {
    for (const m of behind) console.log(`  ${m.name} is missing ${m.missing.length}`);
  }

  // 2. What Hookdeck recorded. One connection, so one row per request.
  const since = values.since ?? new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const requests = (
    await listRequests({ source_id: source.id, created_at_gte: since, limit: 100, dir: "asc" })
  ).models;

  console.log(
    `\nWhat Hookdeck recorded for connection ${connName} across ${requests.length} request(s):\n` +
      `  There is one connection for the whole group, so a request delivered to\n` +
      `  two of ${spec.hosts.length} machines is indistinguishable from one delivered to all of them.\n` +
      `  Nothing above can be derived from the Hookdeck API - it came from the machines' logs.\n`,
  );

  if (!values.retry) {
    console.log("Re-run with --retry to perform a group retry and count the duplicates it causes.\n");
    return;
  }

  // 3. Retry on the group connection. Every attached session gets an event.
  const before = new Map([...byMachine].map(([name, set]) => [name, new Set(set)]));

  // Match the missing deliveries back to their requests by X-GitHub-Delivery.
  const missingDeliveries = new Set(behind.flatMap((m) => m.missing));
  const target = requests.filter((r) => {
    const delivery = r.headers?.["x-github-delivery"] ?? r.headers?.["X-GitHub-Delivery"];
    return delivery !== undefined && missingDeliveries.has(delivery);
  });

  if (target.length === 0) {
    console.log("No request matches a missing delivery, so there is nothing to retry.\n");
    return;
  }

  console.log(`Retrying ${target.length} request(s) on ${connName} (${connection.id})...\n`);
  for (const r of target) {
    const result = await retryRequest(r.id, [connection.id]);
    console.log(`  retried ${r.id} -> ${(result.events ?? []).length} event(s) created`);
  }

  console.log("\nWaiting 5s for delivery, then re-reading machine logs...\n");
  await new Promise((r) => setTimeout(r, 5000));

  let duplicates = 0;
  for (const name of spec.hosts) {
    const now = received(name);
    const seen = new Map<string, number>();
    for (const r of now) seen.set(r.delivery ?? "?", (seen.get(r.delivery ?? "?") ?? 0) + 1);
    const dupes = [...seen.values()].filter((n) => n > 1).length;
    duplicates += dupes;
    const wasBehind = (before.get(name)?.size ?? 0) < union.size;
    console.log(
      `  ${name.padEnd(14)} ${now.length} total delivery/deliveries, ${dupes} duplicated` +
        `${wasBehind ? "  <- this is the machine that was behind" : ""}`,
    );
  }

  console.log(
    `\n${duplicates} duplicated delivery/deliveries across the group.\n` +
      `The retry could not be aimed at one machine: the connection is the group.\n` +
      `The only workaround is for each machine to track the last event it received\n` +
      `and fetch newer ones itself, which moves the problem into every machine.\n`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
