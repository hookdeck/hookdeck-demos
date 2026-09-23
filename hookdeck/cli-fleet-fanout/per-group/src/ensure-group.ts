/**
 * One connection and CLI destination per group.
 *
 * Every machine in the group runs `hookdeck listen` on this connection.
 * Hookdeck creates one event per CLI session, so each attached session
 * receives the event.
 *
 * Hookdeck sees one connection, not N machines. Sessions are not exposed in
 * the dashboard or API, so there is no way to tell which machines are
 * attached, nothing records a miss when one machine is down while others are
 * up, and a retry cannot be aimed at a single machine. See
 * per-group/src/recovery-problem.ts.
 *
 *   npm run ensure:group -- group-a
 */
import { connectionFor, env, fleet, group } from "../../shared/src/config.js";
import { upsertConnection } from "../../shared/src/hookdeck.js";

export async function ensureGroupConnection(
  groupName: string,
  opts: { dryRun?: boolean; quiet?: boolean } = {},
): Promise<string> {
  const spec = group(groupName);
  const conn = connectionFor("per-group", spec.hosts[0]!);
  const sourceType = fleet().sources.find((s) => s.name === conn.source)?.type;
  if (!sourceType) throw new Error(`Unknown source ${conn.source} in fleet.yaml.`);

  const description = `${spec.name} :: ${conn.hosts.length} host(s) listen on this connection`;
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
  const groupName = args.find((a) => !a.startsWith("--"));
  if (!groupName) {
    console.error("usage: npm run ensure:group -- <group-name> [--dry-run]");
    process.exit(2);
  }
  const name = await ensureGroupConnection(groupName, { dryRun });
  console.log(`\nConnection ${name} ensured for ${groupName}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
