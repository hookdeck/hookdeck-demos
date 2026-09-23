import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Approach = "per-machine" | "per-group";

export interface MachineSpec {
  name: string;
  perMachinePort: number;
  perGroupPort: number;
}

export interface GroupSpec {
  name: string;
  description: string;
  repos: string[];
  machines: MachineSpec[];
}

export interface FleetSpec {
  prefix: string;
  cliPath: string;
  sources: { perMachine: string; perGroup: string };
  groups: GroupSpec[];
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
  if (!cached) cached = parseYaml(readFileSync(resolve(ROOT, "fleet.yaml"), "utf8")) as FleetSpec;
  return cached;
}

export const machines = (): MachineSpec[] => fleet().groups.flatMap((g) => g.machines);

export function machine(name: string): MachineSpec {
  const found = machines().find((m) => m.name === name);
  if (!found) {
    throw new Error(`Unknown machine ${name}. Known: ${machines().map((m) => m.name).join(", ")}`);
  }
  return found;
}

export function groupOf(machineName: string): GroupSpec {
  const found = fleet().groups.find((g) => g.machines.some((m) => m.name === machineName));
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

export const sourceName = (approach: Approach): string =>
  approach === "per-machine" ? fleet().sources.perMachine : fleet().sources.perGroup;

/**
 * The connection a given machine listens on.
 *
 * per-machine: one connection per machine, so the connection name identifies
 *   the machine and Hookdeck records delivery (and misses) against it.
 * per-group:   one connection for the whole group. Every machine in the group
 *   attaches a session to the same connection, which is why Hookdeck cannot
 *   tell them apart.
 */
export const connectionName = (approach: Approach, machineName: string): string =>
  approach === "per-machine"
    ? `${fleet().prefix}-${machineName}`
    : `${fleet().prefix}-${groupOf(machineName).name}`;

export const groupConnectionName = (groupName: string): string =>
  `${fleet().prefix}-${groupName}`;

export const portOf = (approach: Approach, machineName: string): number =>
  approach === "per-machine" ? machine(machineName).perMachinePort : machine(machineName).perGroupPort;

/**
 * Connections in the same group share a filter, so every machine in the group
 * matches the same events. Hookdeck filter rules match the parsed JSON body.
 */
export const repoFilter = (repos: string[]): string =>
  JSON.stringify({ repository: { full_name: { $in: repos } } });

export const logPath = (approach: Approach, machineName: string): string =>
  resolve(ROOT, "logs", `${approach}.${machineName}.log`);

export const eventLogPath = (approach: Approach, machineName: string): string =>
  resolve(ROOT, "logs", `${approach}.${machineName}.jsonl`);

export const runDir = (): string => resolve(ROOT, "run");
