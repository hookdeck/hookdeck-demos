/**
 * Create every Hookdeck resource both approaches need, idempotently.
 *
 *   npm run setup                      both approaches
 *   npm run setup -- --approach per-machine
 *   npm run setup -- --dry-run
 *
 * Resolved IDs are written to run/setup.json so the recovery and inspection
 * scripts do not have to look them up on every invocation.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fleet, machines, runDir, sourceName, connectionName, groupConnectionName } from "./config.js";
import { ciLogin, listConnections, listSources, type Connection } from "./hookdeck.js";
import { ensureMachineConnection } from "../../per-machine/src/ensure-connection.js";
import { ensureGroupConnection } from "../../per-group/src/ensure-group.js";

interface SetupState {
  generatedAt: string;
  prefix: string;
  sources: Record<string, { id: string; name: string; url: string }>;
  connections: Record<string, { id: string; name: string; approach: string }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.includes("--approach") ? args[args.indexOf("--approach") + 1] : undefined;

  ciLogin();
  const spec = fleet();

  if (!only || only === "per-machine") {
    console.log("\n=== Approach 1: one connection + CLI destination per machine ===\n");
    for (const m of machines()) ensureMachineConnection(m.name, { dryRun });
  }

  if (!only || only === "per-group") {
    console.log("\n=== Approach 2: one connection + CLI destination per group ===\n");
    for (const g of spec.groups) ensureGroupConnection(g.name, { dryRun });
  }

  if (dryRun) {
    console.log("\nDry run - nothing was created.");
    return;
  }

  // Resolve IDs once and cache them. A run limited to one approach must merge
  // into whatever is already cached rather than replace it, or the other
  // approach's IDs are lost and recover.ts can no longer find its connection.
  const statePath = resolve(runDir(), "setup.json");
  const previous: Partial<SetupState> = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, "utf8")) as SetupState)
    : {};
  const state: SetupState = {
    generatedAt: new Date().toISOString(),
    prefix: spec.prefix,
    sources: { ...(previous.sources ?? {}) },
    connections: { ...(previous.connections ?? {}) },
  };

  for (const approach of ["per-machine", "per-group"] as const) {
    if (only && only !== approach) continue;
    const name = sourceName(approach);
    const found = (await listSources({ name })).models[0];
    if (found) state.sources[approach] = { id: found.id, name: found.name, url: found.url };
  }

  const wanted = new Map<string, string>();
  if (!only || only === "per-machine") {
    for (const m of machines()) wanted.set(connectionName("per-machine", m.name), "per-machine");
  }
  if (!only || only === "per-group") {
    for (const g of spec.groups) wanted.set(groupConnectionName(g.name), "per-group");
  }

  const all: Connection[] = (await listConnections({ limit: 250 })).models;
  for (const [name, approach] of wanted) {
    const match = all.find((c) => c.name === name);
    if (match) state.connections[name] = { id: match.id, name, approach };
    else console.warn(`! could not resolve connection id for ${name}`);
  }

  mkdirSync(runDir(), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  console.log("\n=== Source URLs ===\n");
  for (const [approach, src] of Object.entries(state.sources)) {
    console.log(`  ${approach.padEnd(12)} ${src.name}`);
    console.log(`  ${"".padEnd(12)} ${src.url}`);
  }
  console.log(
    `\nPoint a repository webhook at a source URL (content type application/json,\n` +
      `secret = GITHUB_WEBHOOK_SECRET), or use the local sender:\n` +
      `  npm run send -- --approach per-machine --repo ${spec.groups[0]?.repos[0]}\n`,
  );
  console.log(`Resolved IDs written to run/setup.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
