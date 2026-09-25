import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Approach = "per-machine" | "per-group";

export interface MachineSpec {
  name: string;
}

/**
 * A group is not declared. It is the set of hosts whose connections share a
 * filter, which is exactly what "these machines receive the same events" means.
 * Derived from `connections`, so nothing states it twice.
 */
export interface GroupSpec {
  /** The filter name, which is the group's identity. */
  name: string;
  repos: string[];
  hosts: string[];
}

/**
 * One of the two models the demo compares, as the UI presents it.
 *
 * `id` picks the renderer, so it stays constrained to the two we have. `label`
 * and `source` are data: a scenario can name its sources whatever it likes and
 * title its tabs to suit. Before this existed the source was found by checking
 * whether its name ended with the approach id, which made a naming convention
 * load-bearing.
 */
export interface ApproachSpec {
  id: Approach;
  label: string;
  source: string;
}

export interface SourceSpec {
  name: string;
  type: string;
}

export interface ConnectionDestination {
  name: string;
  type: string;
  /** CLI path Hookdeck appends when it delivers (`--destination-cli-path`). */
  path: string;
}

export interface ConnectionHost {
  host: string;
  port: number;
}

/** The body filter stored on the connection (`--rule-filter-body`). */
export interface ConnectionFilter {
  repository: { full_name: { $in: string[] } };
}

export interface ConnectionSpec {
  name: string;
  source: string;
  destination: ConnectionDestination;
  hosts: ConnectionHost[];
  /** Resolved from the filter name in fleet.yaml. */
  filter: ConnectionFilter;
}

export interface FleetSpec {
  prefix: string;
  approaches: ApproachSpec[];
  groups: GroupSpec[];
  sources: SourceSpec[];
  connections: ConnectionSpec[];
}

/**
 * fleet.yaml as written: groups and connections name a filter rather than
 * repeating it. Resolved into FleetSpec on load.
 */
interface RawFleetSpec {
  prefix: string;
  filters: Record<string, ConnectionFilter>;
  approaches: ApproachSpec[];
  sources: SourceSpec[];
  connections: (Omit<ConnectionSpec, "filter"> & { filter: string })[];
}

/**
 * Minimal .env reader. Avoids a dotenv dependency: the file is a handful of
 * KEY=value lines and we would rather not pull in a package for that.
 */
function loadDotEnv(): void {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

export function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(
      `${key} is not set. Copy .env.example to .env and fill it in (see the README).`,
    );
  }
  return value;
}

/**
 * Matches the API version the pinned CLI targets, so the API client and the
 * CLI cannot disagree about response shapes.
 */
export const apiBase = (): string =>
  (process.env.HOOKDECK_API_BASE ?? "https://api.hookdeck.com/2026-09-01").replace(/\/$/, "");

export interface ScenarioChoice {
  name: string;
  file: string;
}

const SCENARIOS_DIR = resolve(ROOT, "scenarios");

/** `default` is fleet.yaml, the fleet the scripted GIFs were drawn from. */
export function listScenarios(): ScenarioChoice[] {
  const extras = existsSync(SCENARIOS_DIR)
    ? readdirSync(SCENARIOS_DIR)
        .filter((name) => name.endsWith(".yaml"))
        .map((name) => ({
          name: name.slice(0, -".yaml".length),
          file: resolve(SCENARIOS_DIR, name),
        }))
    : [];
  return [{ name: "default", file: resolve(ROOT, "fleet.yaml") }, ...extras];
}

let scenarioName = "default";
let cached: { file: string; mtimeMs: number; spec: FleetSpec } | undefined;

/** Select the fleet file for this process. Call before anything reads `fleet()`. */
export function useScenario(name: string): ScenarioChoice {
  const found = listScenarios().find((scenario) => scenario.name === name);
  if (!found) {
    throw new Error(`Unknown scenario ${name}. Known: ${listScenarios().map((s) => s.name).join(", ")}`);
  }
  scenarioName = name;
  cached = undefined;
  return found;
}

export function activeScenario(): ScenarioChoice {
  return listScenarios().find((scenario) => scenario.name === scenarioName) ?? listScenarios()[0]!;
}

/** Drop `--scenario <name>` from argv and select that fleet for this process. */
export function applyScenarioArg(argv: string[]): string[] {
  const index = argv.indexOf("--scenario");
  if (index === -1) return argv;
  const name = argv[index + 1];
  if (!name || name.startsWith("-")) {
    throw new Error(`--scenario needs a name. Known: ${listScenarios().map((s) => s.name).join(", ")}`);
  }
  useScenario(name);
  return [...argv.slice(0, index), ...argv.slice(index + 2)];
}

export function fleet(): FleetSpec {
  const choice = activeScenario();
  const mtimeMs = statSync(choice.file).mtimeMs;
  if (!cached || cached.file !== choice.file || cached.mtimeMs !== mtimeMs) {
    const raw = parseYaml(readFileSync(choice.file, "utf8")) as RawFleetSpec;
    const spec = resolveFleet(raw);
    validateFleet(spec);
    cached = { file: choice.file, mtimeMs, spec };
  }
  return cached.spec;
}

/** Look up a named filter, failing loudly rather than silently matching nothing. */
function filterByName(raw: RawFleetSpec, name: string, usedBy: string): ConnectionFilter {
  const found = raw.filters?.[name];
  if (!found) {
    throw new Error(
      `${usedBy} uses unknown filter "${name}". Known filters: ${Object.keys(raw.filters ?? {}).join(", ") || "(none)"}.`,
    );
  }
  return found;
}

/** Expand the filter names, then derive the groups from what shares a filter. */
function resolveFleet(raw: RawFleetSpec): FleetSpec {
  const connections = raw.connections.map((connection) => ({
    ...connection,
    filter: filterByName(raw, connection.filter, `Connection ${connection.name}`),
  }));

  const hostsByFilter = new Map<string, string[]>();
  for (const connection of raw.connections) {
    const hosts = hostsByFilter.get(connection.filter) ?? [];
    for (const { host } of connection.hosts) if (!hosts.includes(host)) hosts.push(host);
    hostsByFilter.set(connection.filter, hosts);
  }

  return {
    prefix: raw.prefix,
    approaches: raw.approaches ?? [],
    sources: raw.sources,
    connections,
    groups: [...hostsByFilter].map(([name, hosts]) => ({
      name,
      hosts,
      repos: reposOf(filterByName(raw, name, `Group ${name}`)),
    })),
  };
}

/**
 * The repositories a filter matches. The sender and the visualization offer
 * these as choices, so this assumes the demo's filter shape rather than
 * handling arbitrary Hookdeck filter syntax.
 */
const reposOf = (filter: ConnectionFilter): string[] =>
  filter.repository?.full_name?.$in ?? [];

function validateFleet(spec: FleetSpec): void {
  const sources = new Set(spec.sources.map((s) => s.name));

  if (spec.approaches.length === 0) {
    throw new Error("fleet.yaml needs an `approaches` section naming each model's source.");
  }
  const seen = new Set<string>();
  for (const approach of spec.approaches) {
    if (approach.id !== "per-machine" && approach.id !== "per-group") {
      throw new Error(`Approach id ${approach.id} must be per-machine or per-group.`);
    }
    if (seen.has(approach.id)) throw new Error(`Approach ${approach.id} is declared twice.`);
    seen.add(approach.id);
    if (!sources.has(approach.source)) {
      throw new Error(`Approach ${approach.id} uses unknown source ${approach.source}.`);
    }
  }
  for (const connection of spec.connections) {
    if (!sources.has(connection.source)) {
      throw new Error(`Connection ${connection.name} uses unknown source ${connection.source}.`);
    }
    if (connection.hosts.length === 0) {
      throw new Error(`Connection ${connection.name} has no listening hosts.`);
    }
    if (!connection.destination.path?.startsWith("/")) {
      throw new Error(`Connection ${connection.name} needs a destination path starting with /.`);
    }
  }

  // A host belongs to one group, so it must not appear under two filters.
  for (const group of spec.groups) {
    for (const host of group.hosts) {
      const others = spec.groups.filter((g) => g !== group && g.hosts.includes(host));
      if (others.length > 0) {
        throw new Error(
          `Host ${host} is in more than one group: ${[group, ...others].map((g) => g.name).join(", ")}.`,
        );
      }
    }
  }
}

export const machines = (): MachineSpec[] =>
  fleet().groups.flatMap((g) => g.hosts.map((name) => ({ name })));

export function machine(name: string): MachineSpec {
  const found = machines().find((m) => m.name === name);
  if (!found) {
    throw new Error(`Unknown machine ${name}. Known: ${machines().map((m) => m.name).join(", ")}`);
  }
  return found;
}

export function groupOf(machineName: string): GroupSpec {
  const found = fleet().groups.find((g) => g.hosts.includes(machineName));
  if (!found) throw new Error(`Unknown machine ${machineName}`);
  return found;
}

export function group(name: string): GroupSpec {
  const found = fleet().groups.find((g) => g.name === name);
  if (!found) {
    throw new Error(`Unknown group ${name}. Known: ${fleet().groups.map((g) => g.name).join(", ")}`);
  }
  return found;
}

export const approaches = (): ApproachSpec[] => fleet().approaches;

export function approachSpec(approach: Approach): ApproachSpec {
  const found = fleet().approaches.find((a) => a.id === approach);
  if (!found) {
    throw new Error(
      `No approach ${approach} in this scenario. Declared: ${fleet().approaches.map((a) => a.id).join(", ")}`,
    );
  }
  return found;
}

export const sourceName = (approach: Approach): string => approachSpec(approach).source;

/** The connection this host listens on for that source. Declared in fleet.yaml. */
export function connectionFor(approach: Approach, machineName: string): ConnectionSpec {
  const source = sourceName(approach);
  const found = fleet().connections.find(
    (c) => c.source === source && c.hosts.some((h) => h.host === machineName),
  );
  if (!found) {
    throw new Error(`No connection on ${source} listens for ${machineName}.`);
  }
  return found;
}

export const connectionName = (approach: Approach, machineName: string): string =>
  connectionFor(approach, machineName).name;

export const groupConnectionName = (groupName: string): string => {
  const hosts = new Set(group(groupName).hosts);
  const source = sourceName("per-group");
  const found = fleet().connections.find(
    (c) =>
      c.source === source &&
      c.hosts.length === hosts.size &&
      c.hosts.every((h) => hosts.has(h.host)),
  );
  if (!found) throw new Error(`No per-group connection for ${groupName}.`);
  return found.name;
};

export const portOf = (approach: Approach, machineName: string): number => {
  const listen = connectionFor(approach, machineName).hosts.find((h) => h.host === machineName);
  if (!listen) throw new Error(`No listen port for ${machineName} on ${approach}.`);
  return listen.port;
};

/**
 * Connections in the same group share a filter, so every machine in the group
 * matches the same events. Hookdeck filter rules match the parsed JSON body.
 */
export const repoFilter = (filter: ConnectionFilter): string => JSON.stringify(filter);

export const logPath = (approach: Approach, machineName: string): string =>
  resolve(ROOT, "logs", `${approach}.${machineName}.log`);

export const eventLogPath = (approach: Approach, machineName: string): string =>
  resolve(ROOT, "logs", `${approach}.${machineName}.jsonl`);

export const runDir = (): string => resolve(ROOT, "run");
