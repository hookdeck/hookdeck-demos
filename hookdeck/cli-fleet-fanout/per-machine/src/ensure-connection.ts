/**
 * Approach 1: one connection + CLI destination per machine.
 *
 * This is the script a machine runs at launch. It is idempotent, so it is safe
 * on every boot, on a redeploy, or when the fleet definition changes: `hookdeck
 * gateway connection upsert` creates the connection the first time and updates
 * only the properties given on later runs.
 *
 *   npm run ensure:machine -- group-a-host-01
 *   npm run ensure:machine -- group-a-host-01 --dry-run
 *
 * The connection must exist before `hookdeck listen` runs. If listen finds no
 * connection for a source it creates one called `cli-<source>`, and every later
 * listen on that source attaches to that one instead - which would silently
 * collapse approach 1 into approach 2.
 */
import {
  connectionName,
  env,
  fleet,
  groupOf,
  machine,
  repoFilter,
  sourceName,
} from "../../shared/src/config.js";
import { cli, ciLogin } from "../../shared/src/hookdeck.js";

export function ensureMachineConnection(
  machineName: string,
  opts: { dryRun?: boolean; quiet?: boolean } = {},
): string {
  const spec = machine(machineName);
  const group = groupOf(machineName);
  const name = connectionName("per-machine", spec.name);

  const args = [
    "gateway",
    "connection",
    "upsert",
    name,
    "--source-name",
    sourceName("per-machine"),
    // A real provider source type, so signature verification runs exactly as it
    // would in production rather than being skipped.
    "--source-type",
    "GITHUB",
    "--source-webhook-secret",
    env("GITHUB_WEBHOOK_SECRET"),
    "--destination-name",
    name,
    "--destination-type",
    "CLI",
    // Set the CLI path here, on the connection. Never with `listen --path`,
    // which writes the path to the server and persists it.
    "--destination-cli-path",
    fleet().cliPath,
    // Every machine in a group carries the same filter, so all of them match
    // the same events. A group of one is how the one-to-one case is expressed.
    "--rule-filter-body",
    repoFilter(group.repos),
    "--description",
    `${group.name} :: ${spec.name}`,
    ...(opts.dryRun ? ["--dry-run"] : []),
  ];

  const out = cli(args, { quiet: opts.quiet });
  if (!opts.quiet) process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
  return name;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const machineName = args.find((a) => !a.startsWith("--"));
  if (!machineName) {
    console.error("usage: npm run ensure:machine -- <machine-name> [--dry-run]");
    process.exit(2);
  }
  ciLogin();
  const name = ensureMachineConnection(machineName, { dryRun });
  console.log(`\nConnection ${name} ensured for ${machineName}.`);
  console.log(`Next: npm run fleet -- up per-machine ${machineName}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
