/**
 * One connection and CLI destination per machine.
 *
 * Idempotent. `PUT /connections` creates the connection the first time and
 * updates its rules and description after that. Safe on every boot.
 *
 *   npm run ensure:machine -- group-a-host-01
 *   npm run ensure:machine -- group-a-host-01 --dry-run
 *
 * The connection must exist before `hookdeck listen` runs. If listen finds no
 * connection for a source it creates one called `cli-<source>`, and every later
 * listen on that source attaches to that one instead.
 */
import { connectionFor, env, fleet, groupOf } from "../../shared/src/config.js";
import { upsertConnection } from "../../shared/src/hookdeck.js";

export async function ensureMachineConnection(
  machineName: string,
  opts: { dryRun?: boolean; quiet?: boolean } = {},
): Promise<string> {
  const group = groupOf(machineName);
  const conn = connectionFor("per-machine", machineName);
  const sourceType = fleet().sources.find((s) => s.name === conn.source)?.type;
  if (!sourceType) throw new Error(`Unknown source ${conn.source} in this scenario.`);

  const description = `${group.name} :: ${machineName}`;
  if (opts.dryRun) {
    console.log(`PUT /connections ${conn.name}`);
    console.log(`  source ${conn.source} ${sourceType}`);
    console.log(`  destination ${conn.destination.name} ${conn.destination.type} ${conn.destination.path}`);
    console.log(`  filter ${JSON.stringify(conn.filter)}`);
    return conn.name;
  }

  const result = await upsertConnection({
    name: conn.name,
    description,
    sourceName: conn.source,
    sourceType,
    destinationName: conn.destination.name,
    destinationType: conn.destination.type,
    destinationPath: conn.destination.path,
    filter: conn.filter,
    webhookSecret: env("GITHUB_WEBHOOK_SECRET"),
  });
  if (!opts.quiet) {
    console.log(`PUT /connections ${conn.name} -> ${result.id}`);
    if (result.source) console.log(`  source ${result.source.name} (${result.source.id})`);
    if (result.destination) console.log(`  destination ${result.destination.name} (${result.destination.id})`);
  }
  return conn.name;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const machineName = args.find((a) => !a.startsWith("--"));
  if (!machineName) {
    console.error("usage: npm run ensure:machine -- <machine-name> [--dry-run]");
    process.exit(2);
  }
  const name = await ensureMachineConnection(machineName, { dryRun });
  console.log(`\nConnection ${name} ensured for ${machineName}.`);
  console.log(`Next: npm run fleet -- up per-machine ${machineName}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
