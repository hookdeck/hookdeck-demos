import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, apiBase, env, runDir, type Approach } from "./config.js";

/**
 * Thin Hookdeck API client. Only the handful of endpoints this demo needs.
 *
 * Note on `retryRequest`: the `webhook_ids` body field limits a retry to
 * specific connections. It is what `hookdeck gateway request retry
 * --connection-ids` sends, but it is not in the public API reference. See
 * FINDINGS.md.
 */

export interface Page<T> {
  models: T[];
  pagination?: { order_by: string; dir: string; next?: string; prev?: string };
  count?: number;
}

export interface HookdeckRequest {
  id: string;
  source_id: string;
  created_at: string;
  events_count?: number | null;
  ignored_count?: number | null;
  rejection_cause?: string | null;
  headers?: Record<string, string> | null;
  parsed_query?: unknown;
  verified?: boolean;
}

export interface HookdeckEvent {
  id: string;
  request_id: string;
  webhook_id: string; // connection id
  destination_id: string;
  status: string;
  attempts?: number;
  created_at: string;
}

export interface IgnoredEvent {
  id: string;
  request_id: string;
  webhook_id: string; // connection id
  cause: string;
  created_at: string;
}

export interface Connection {
  id: string;
  name: string;
  source_id: string;
  destination_id: string;
  disabled_at?: string | null;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  type?: string;
}

export interface Destination {
  id: string;
  name: string;
  type?: string;
}

const auth = (): string => `Bearer ${env("HOOKDECK_API_KEY")}`;

async function api<T>(
  path: string,
  init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(apiBase() + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: auth(),
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${url.pathname}${url.search} -> ${res.status} ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export const listRequests = (query: {
  source_id?: string;
  created_at_gte?: string;
  limit?: number;
  order_by?: string;
  dir?: string;
}): Promise<Page<HookdeckRequest>> =>
  api("/requests", {
    query: {
      source_id: query.source_id,
      // The API takes bracketed comparison operators for date filters.
      "created_at[gte]": query.created_at_gte,
      limit: query.limit ?? 100,
      order_by: query.order_by ?? "created_at",
      dir: query.dir ?? "desc",
    },
  });

export const getRequest = (id: string): Promise<HookdeckRequest> => api(`/requests/${id}`);

/**
 * Events for one request.
 *
 * Use the nested path, not `GET /events?request_id=...`. That query parameter
 * is accepted and silently ignored - it returns unrelated events, which made
 * the "has this connection already been delivered to?" check in recover.ts
 * always true and would have skipped every recovery. See FINDINGS.md.
 */
export const listEventsForRequest = (requestId: string): Promise<Page<HookdeckEvent>> =>
  api(`/requests/${requestId}/events`, { query: { limit: 100 } });

export const listIgnoredEventsForRequest = (requestId: string): Promise<Page<IgnoredEvent>> =>
  api(`/requests/${requestId}/ignored_events`, { query: { limit: 100 } });

/**
 * Retry a request. Pass connection IDs to limit the retry to those connections
 * - this is what makes per-machine recovery possible without duplicating the
 * event to machines that already have it.
 */
export const retryRequest = (
  requestId: string,
  connectionIds?: string[],
): Promise<{ request: HookdeckRequest; events: HookdeckEvent[] }> =>
  api(`/requests/${requestId}/retry`, {
    method: "POST",
    body: connectionIds?.length ? { webhook_ids: connectionIds } : {},
  });

/** Retry a single event. Used for FAILED events, e.g. CLI_UNAVAILABLE. */
export const retryEvent = (eventId: string): Promise<HookdeckEvent> =>
  api(`/events/${eventId}/retry`, { method: "POST" });

export const listAttemptsForEvent = (eventId: string): Promise<Page<{ id: string; error_code?: string | null; status?: string }>> =>
  api("/attempts", { query: { event_id: eventId, limit: 10 } });

export const listConnections = (
  query: { name?: string; limit?: number; next?: string } = {},
): Promise<Page<Connection>> =>
  api("/connections", { query: { name: query.name, limit: query.limit ?? 100, next: query.next } });

export const listSources = (query: { name?: string; limit?: number } = {}): Promise<Page<Source>> =>
  api("/sources", { query: { name: query.name, limit: query.limit ?? 100 } });

export const listDestinations = (query: { name?: string; limit?: number } = {}): Promise<Page<Destination>> =>
  api("/destinations", { query: { name: query.name, limit: query.limit ?? 100 } });

/**
 * Create a connection or update the one with this name.
 *
 * Source and destination are matched by name. Rules and description are
 * replaced. The source and destination binding on an existing connection
 * stays as it is.
 */
export function upsertConnection(input: {
  name: string;
  description: string;
  sourceName: string;
  sourceType: string;
  destinationName: string;
  destinationType: string;
  destinationPath: string;
  filter: unknown;
  webhookSecret: string;
}): Promise<Connection & { source?: Source; destination?: Destination }> {
  return api("/connections", {
    method: "PUT",
    body: {
      name: input.name,
      description: input.description,
      source: {
        name: input.sourceName,
        type: input.sourceType,
        config: { auth: { webhook_secret_key: input.webhookSecret } },
      },
      destination: {
        name: input.destinationName,
        type: input.destinationType,
        config: { path: input.destinationPath },
      },
      rules: [{ type: "filter", body: input.filter }],
    },
  });
}

export const deleteConnection = (id: string): Promise<unknown> =>
  api(`/connections/${id}`, { method: "DELETE" });

/** Every connection in the project, following pagination. */
export async function listAllConnections(): Promise<Connection[]> {
  const found: Connection[] = [];
  let next: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await listConnections({ limit: 250, next });
    found.push(...result.models);
    const cursor = result.pagination?.next;
    if (!cursor || result.models.length === 0) return found;
    next = cursor.startsWith("http") ? (new URL(cursor).searchParams.get("next") ?? undefined) : cursor;
    if (!next) return found;
  }
  return found;
}

/** Delete every connection in the project. Sources and destinations stay. */
export async function deleteAllConnections(): Promise<Connection[]> {
  const found = await listAllConnections();
  for (const connection of found) {
    await deleteConnection(connection.id);
  }
  return found;
}
export const deleteSource = (id: string): Promise<unknown> =>
  api(`/sources/${id}`, { method: "DELETE" });
export const deleteDestination = (id: string): Promise<unknown> =>
  api(`/destinations/${id}`, { method: "DELETE" });

/**
 * Run a hookdeck CLI command. Echoes the command first so a demo viewer can
 * see exactly what is being run, and so the output can be pasted into FINDINGS.
 */
export function cli(
  args: string[],
  opts: { quiet?: boolean; allowFailure?: boolean; configPath?: string } = {},
): string {
  if (!opts.quiet) console.log(`$ hookdeck ${args.join(" ")}`);
  const res = spawnSync(
    hookdeckBin(),
    [...args, "--hookdeck-config", opts.configPath ?? cliConfigPath()],
    { encoding: "utf8" },
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (res.status !== 0 && !opts.allowFailure) {
    throw new Error(`hookdeck ${args.join(" ")} failed (${res.status}):\n${out}`);
  }
  return out;
}

/**
 * The demo keeps its CLI credentials in its own config file rather than the
 * shared ~/.config/hookdeck/config.toml. Running the demo therefore cannot
 * clobber, or accidentally act on, whatever project you are logged into
 * interactively.
 */
export const cliConfigPath = (): string => resolve(runDir(), "hookdeck-cli.toml");

/** One CLI client per listener. Sessions that share a client collapse to one event. */
export const listenerConfigPath = (approach: Approach, machineName: string): string =>
  resolve(runDir(), `hookdeck-cli.${approach}.${machineName}.toml`);

/**
 * The CLI is an npm dependency rather than a global install, so the demo runs
 * a known, pinned version. FINDINGS.md records behavior per version, and a
 * globally installed CLI would quietly invalidate that.
 *
 * We resolve the platform binary directly instead of going through
 * node_modules/.bin/hookdeck. That wrapper runs the binary with
 * `execFileSync`, which blocks the Node event loop and forwards no signals, so
 * a SIGINT sent to the wrapper never reaches the CLI. `listen` would then be
 * killed rather than shut down cleanly, and a killed session is held for the
 * reconnect grace window instead of being dropped immediately - which is the
 * opposite of what a clean stop is supposed to do. See FINDINGS.md.
 */
export function hookdeckBin(): string {
  const archMap: Record<string, string> = { x64: "amd64", arm64: "arm64", ia32: "386" };
  const goArch = archMap[process.arch] ?? process.arch;
  const name = process.platform === "win32" ? "hookdeck.exe" : "hookdeck";
  const direct = resolve(
    ROOT,
    `node_modules/hookdeck-cli/binaries/${process.platform}-${goArch}/${name}`,
  );
  return existsSync(direct) ? direct : resolve(ROOT, "node_modules/.bin/hookdeck");
}

export const configFlag = (): string[] => ["--hookdeck-config", cliConfigPath()];

/**
 * Authenticate the CLI non-interactively against the project the API key
 * belongs to. Safe to call repeatedly.
 */
export function ciLogin(configPath?: string): void {
  const path = configPath ?? cliConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  cli(["ci", "--api-key", env("HOOKDECK_API_KEY")], { quiet: true, configPath: path });
}
