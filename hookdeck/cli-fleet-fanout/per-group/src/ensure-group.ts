/**
 * Approach 2: one connection + CLI destination per group.
 *
 * Every machine in the group runs `hookdeck listen <port> <source> <group
 * connection>`. Hookdeck creates one event per attached session, so all
 * machines in the group receive every matching event - the fan-out requirement
 * is met.
 *
 * What it costs: Hookdeck sees one connection, not N machines. Sessions are
 * not exposed in the dashboard or API, so there is no way to tell which
 * machines are attached, nothing records a miss when one machine is down while
 * others are up, and a retry cannot be aimed at a single machine. See
 * per-group/src/recovery-problem.ts and FINDINGS.md.
 *
 *   npm run ensure:group -- group-a
 */
import { env, fleet, group, groupConnectionName, repoFilter, sourceName } from "../../shared/src/config.js";
import { cli, ciLogin } from "../../shared/src/hookdeck.js";

export function ensureGroupConnection(
  groupName: string,
  opts: { dryRun?: boolean; quiet?: boolean } = {},
): string {
  const spec = group(groupName);
  const name = groupConnectionName(spec.name);

  const args = [
    "gateway",
    "connection",
    "upsert",
    name,
    "--source-name",
    sourceName("per-group"),
    "--source-type",
    "GITHUB",
    "--source-webhook-secret",
    env("GITHUB_WEBHOOK_SECRET"),
    "--destination-name",
    name,
    "--destination-type",
    "CLI",
    "--destination-cli-path",
    fleet().cliPath,
    "--rule-filter-body",
    repoFilter(spec.repos),
    "--description",
    `${spec.name} :: ${spec.machines.length} machine(s) share this connection`,
    ...(opts.dryRun ? ["--dry-run"] : []),
  ];

  const out = cli(args, { quiet: opts.quiet });
  if (!opts.quiet) process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
  return name;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const groupName = args.find((a) => !a.startsWith("--"));
  if (!groupName) {
    console.error("usage: npm run ensure:group -- <group-name> [--dry-run]");
    process.exit(2);
  }
  ciLogin();
  const name = ensureGroupConnection(groupName, { dryRun });
  console.log(`\nConnection ${name} ensured for ${groupName}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
