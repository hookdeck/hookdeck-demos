/**
 * Show, per request, what each connection did with it: delivered, or ignored
 * and why. This is the visual proof for every scenario - and the difference
 * between the two approaches shows up here more clearly than anywhere else.
 *
 *   npm run inspect -- --approach per-machine
 *   npm run inspect -- --approach per-group --since 2026-09-23T10:00:00Z
 *   npm run inspect -- --approach per-machine --request req_abc123
 *
 * Under approach 1 a downed machine leaves a CLI_DISCONNECTED row against its
 * own connection. Under approach 2 there is one row for the whole group, so a
 * request delivered to two of three machines looks identical to one delivered
 * to all three.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runDir, type Approach } from "./config.js";
import {
  ciLogin,
  listEventsForRequest,
  listIgnoredEventsForRequest,
  listRequests,
  type HookdeckRequest,
} from "./hookdeck.js";

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

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      approach: { type: "string", default: "per-machine" },
      since: { type: "string" },
      request: { type: "string" },
      limit: { type: "string", default: "20" },
    },
  });
  const approach = values.approach as Approach;
  const since = values.since ?? new Date(Date.now() - 30 * 60 * 1000).toISOString();

  ciLogin();
  const state = setupState();
  const source = state.sources[approach];
  if (!source) throw new Error(`No ${approach} source in run/setup.json.`);

  // connection id -> display name, for connections belonging to this approach
  const names = new Map<string, string>();
  for (const c of Object.values(state.connections)) {
    if (c.approach === approach) names.set(c.id, c.name);
  }

  const requests: HookdeckRequest[] = values.request
    ? (await listRequests({ source_id: source.id, limit: 250 })).models.filter(
        (r) => r.id === values.request,
      )
    : (
        await listRequests({
          source_id: source.id,
          created_at_gte: since,
          limit: Number(values.limit),
          dir: "desc",
        })
      ).models;

  console.log(`\n${approach}  source=${source.name}  since=${values.request ?? since}`);
  console.log(`${requests.length} request(s)\n`);

  for (const request of requests.reverse()) {
    const events = (await listEventsForRequest(request.id)).models;
    const ignored = (await listIgnoredEventsForRequest(request.id)).models;

    console.log(`${request.id}  ${request.created_at}  verified=${request.verified ?? "?"}`);
    const rows = [
      ...events.map((e) => ({
        connection: names.get(e.webhook_id) ?? e.webhook_id,
        outcome: `event ${e.id} status=${e.status}`,
      })),
      ...ignored.map((e) => ({
        connection: names.get(e.webhook_id) ?? e.webhook_id,
        outcome: `IGNORED ${e.cause}`,
      })),
    ].sort((a, b) => a.connection.localeCompare(b.connection));

    if (rows.length === 0) console.log(`  (no events, no ignored events)`);
    for (const row of rows) console.log(`  ${row.connection.padEnd(30)} ${row.outcome}`);
    console.log("");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
