import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Approach = "per-machine" | "per-group";

export interface MachineSpec {
  name: string;
}

export interface GroupSpec {
  name: string;
  description: string;
  /** Name of the entry in `filters`. */
  filter: string;
  /**
   * Repositories this group receives, read out of its filter. Derived rather
   * than declared, so a repository is named in exactly one place.
   */
  repos: string[];
  hosts: string[];
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
  /** Name of the entry in `filters`; shared by every connection in a group. */
  filterName: string;
  /** The filter itself, resolved from `filterName`. */
  filter: ConnectionFilter;
}

export interface FleetSpec {
  prefix: string;
  filters: Record<string, ConnectionFilter>;
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
  groups: (Omit<GroupSpec, "repos"> & { filter: string })[];
  sources: SourceSpec[];
  connections: (Omit<ConnectionSpec, "filter" | "filterName"> & { filter: string })[];
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

let cached: FleetSpec | undefined;

export function fleet(): FleetSpec {
  if (!cached) {
    const raw = parseYaml(readFileSync(resolve(ROOT, "fleet.yaml"), "utf8")) as RawFleetSpec;
    cached = resolveFleet(raw);
    validateFleet(cached);
  }
  return cached;
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

/**
 * Expand the filter names into the filters themselves, and derive each group's
 * repository list from its filter so the repositories are declared once.
 */
function resolveFleet(raw: RawFleetSpec): FleetSpec {
  return {
    prefix: raw.prefix,
    filters: raw.filters ?? {},
    sources: raw.sources,
    groups: raw.groups.map((group) => ({
      ...group,
      repos: reposOf(filterByName(raw, group.filter, `Group ${group.name}`)),
    })),
    connections: raw.connections.map((connection) => ({
      ...connection,
      filterName: connection.filter,
      filter: filterByName(raw, connection.filter, `Connection ${connection.name}`),
    })),
  };
}

/**
 * The repositories a filter matches. The sender and the visualization offer
 * these as choices, so this assumes the demo's filter shape rather than
 * handling arbitrary Hookdeck filter syntax.
 */
export const reposOf = (filter: ConnectionFilter): string[] =>
  filter.repository?.full_name?.$in ?? [];

function validateFleet(spec: FleetSpec): void {
  const hosts = new Set(spec.groups.flatMap((g) => g.hosts));
  const sources = new Set(spec.sources.map((s) => s.name));
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
    const groups = new Set(connection.hosts.map((h) => {
      if (!hosts.has(h.host)) {
        throw new Error(`Connection ${connection.name} listens with unknown host ${h.host}.`);
      }
      return spec.groups.find((g) => g.hosts.includes(h.host))!.name;
    }));
    if (groups.size !== 1) {
      throw new Error(`Connection ${connection.name} listens with hosts from more than one group.`);
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

export const sourceName = (approach: Approach): string => {
  const found = fleet().sources.find((s) => s.name.endsWith(approach));
  if (!found) {
    throw new Error(`No source in fleet.yaml ends with ${approach}.`);
  }
  return found.name;
};

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
