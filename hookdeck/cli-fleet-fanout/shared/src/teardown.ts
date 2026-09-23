/**
 * Remove everything this demo created, and nothing else.
 *
 *   npm run teardown              prompt-free; deletes by name prefix
 *   npm run teardown -- --dry-run list what would be deleted
 *
 * Every resource the demo creates is named with the prefix from fleet.yaml, so
 * teardown can select on that and leave the rest of the project untouched.
 * CLI sessions are stopped first, so they drop before the connection is gone.
 * Connections are deleted next, then the destinations and sources they used.
 */
import { rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyScenarioArg, fleet, runDir } from "./config.js";
import { stopSessions } from "./fleet.js";
import {
  ciLogin,
  deleteConnection,
  deleteDestination,
  deleteSource,
  listConnections,
  listDestinations,
  listSources,
} from "./hookdeck.js";

async function main(): Promise<void> {
  const argv = applyScenarioArg(process.argv.slice(2));
  process.argv = [process.argv[0]!, process.argv[1]!, ...argv];
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false }, "keep-local": { type: "boolean", default: false } },
  });
  const dryRun = values["dry-run"];
  const prefix = fleet().prefix;

  ciLogin();

  const connections = (await listConnections({ limit: 250 })).models.filter((c) =>
    c.name?.startsWith(prefix),
  );
  const sources = (await listSources({ limit: 250 })).models.filter((s) => s.name.startsWith(prefix));
  const destinations = (await listDestinations({ limit: 250 })).models.filter((d) =>
    d.name.startsWith(prefix),
  );

  console.log(
    `\nMatching "${prefix}*": ${connections.length} connection(s), ` +
      `${destinations.length} destination(s), ${sources.length} source(s)\n`,
  );

  for (const c of connections) console.log(`  connection  ${c.name} (${c.id})`);
  for (const d of destinations) console.log(`  destination ${d.name} (${d.id})`);
  for (const s of sources) console.log(`  source      ${s.name} (${s.id})`);

  if (dryRun) {
    console.log("\nDry run - nothing deleted.\n");
    return;
  }

  console.log("\n=== Stopping CLI sessions ===\n");
  stopSessions();

  console.log("");
  // Connections first: a destination or source still in use cannot be removed.
  for (const c of connections) {
    await deleteConnection(c.id);
    console.log(`  deleted connection  ${c.name}`);
  }
  for (const d of destinations) {
    await deleteDestination(d.id);
    console.log(`  deleted destination ${d.name}`);
  }
  for (const s of sources) {
    await deleteSource(s.id);
    console.log(`  deleted source      ${s.name}`);
  }

  if (!values["keep-local"]) {
    rmSync(runDir(), { recursive: true, force: true });
    console.log(`\n  removed run/ (cached IDs, pidfiles, demo CLI credentials)`);
    console.log(`  logs/ kept; delete it by hand if you want a clean slate`);
  }

  console.log("\nTeardown complete.\n");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
