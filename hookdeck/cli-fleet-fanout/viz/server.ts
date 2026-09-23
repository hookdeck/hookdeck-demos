/**
 * Local demo UI. Serves the fleet diagram and drives the same processes,
 * webhook sender, and Hookdeck API the CLI already uses. The API key stays
 * in .env; the browser only sees machine state and delivery outcomes.
 *
 *   npm run viz
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eventLogPath, fleet, machines, type Approach } from "../shared/src/config.js";
import { crash, down, status, stopSessions, up, type MachineStatus } from "../shared/src/fleet.js";
import {
  deleteAllConnections,
  getRequest,
  listEventsForRequest,
  listIgnoredEventsForRequest,
  listRequests,
  type HookdeckEvent,
  type HookdeckRequest,
  type IgnoredEvent,
} from "../shared/src/hookdeck.js";
import { send, type SendResult } from "../shared/src/send-webhook.js";
import { clearCachedConnections, runSetup } from "../shared/src/setup.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VIZ_PORT ?? 4173);
const APPROACHES: Approach[] = ["per-machine", "per-group"];
const PALETTE = ["#6ea8fe", "#f0b429", "#5dcaa5", "#d2a8ff", "#ff8b6a"];
const EVENTS = new Set(["push", "pull_request", "workflow_run"]);

interface SetupState {
  sources: Record<string, { id: string; name: string; url: string }>;
  connections: Record<string, { id: string; name: string; approach: string }>;
}

interface LaneRecord {
  machine: string;
  outcome: "delivered" | "disconnected";
  cause?: string;
}

interface Delivery {
  delivery: string;
  approach: Approach;
  repo: string;
  event: string;
  color: string;
  label: string;
  sentAt: string;
  targets: string[];
  upAtSend: string[];
  requestId?: string;
  local: string[];
  hookdeckLanes: LaneRecord[];
  callout: string;
  calloutTone: "ok" | "bad" | "pending";
}

const deliveries: Delivery[] = [];
let colorIndex = 0;

function clearDeliveries(): void {
  deliveries.length = 0;
  colorIndex = 0;
}
const requestCache = new Map<string, HookdeckRequest>();

function readSetup(): SetupState {
  const path = resolve(HERE, "../run/setup.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SetupState;
  } catch {
    throw new Error("run/setup.json not found. Run `npm run setup` first.");
  }
}

function knownMachine(name: string): boolean {
  return machines().some((m) => m.name === name);
}

function machineFromConnection(approach: Approach, connectionName: string): string | undefined {
  const prefix = `${fleet().prefix}-`;
  if (!connectionName.startsWith(prefix)) return undefined;
  const rest = connectionName.slice(prefix.length);
  if (approach === "per-machine" && knownMachine(rest)) return rest;
  return undefined;
}

function targetsFor(repo: string): string[] {
  return fleet()
    .groups.filter((group) => group.repos.includes(repo))
    .flatMap((group) => group.hosts);
}

function resolveNames(requested: unknown): string[] {
  const all = machines().map((m) => m.name);
  if (!Array.isArray(requested) || requested.length === 0) return all;
  const names: string[] = [];
  for (const name of requested) {
    if (typeof name !== "string" || !all.includes(name)) {
      throw new Error(`Unknown machine ${String(name)}. Known: ${all.join(", ")}`);
    }
    names.push(name);
  }
  return names;
}

function isApproach(value: unknown): value is Approach {
  return value === "per-machine" || value === "per-group";
}

function connectionCounts(): Record<Approach, number> {
  const counts: Record<Approach, number> = { "per-machine": 0, "per-group": 0 };
  let setup: SetupState;
  try {
    setup = readSetup();
  } catch {
    return counts;
  }
  for (const connection of Object.values(setup.connections ?? {})) {
    if (connection.approach === "per-machine" || connection.approach === "per-group") {
      counts[connection.approach] += 1;
    }
  }
  return counts;
}

function snapshot(): {
  groups: { name: string; repos: string[]; machines: string[] }[];
  approaches: Record<Approach, MachineStatus[]>;
  connections: Record<Approach, number>;
  deliveries: Delivery[];
  error?: string;
} {
  const rows = status(APPROACHES, { quiet: true });
  const approaches = {
    "per-machine": rows[0]?.machines ?? [],
    "per-group": rows[1]?.machines ?? [],
  };
  let error: string | undefined;
  try {
    readSetup();
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    groups: fleet().groups.map((group) => ({
      name: group.name,
      repos: group.repos,
      machines: group.hosts,
    })),
    approaches,
    connections: connectionCounts(),
    deliveries,
    error,
  };
}

function refreshLocal(): void {
  const want = new Set(deliveries.map((d) => d.delivery));
  for (const delivery of deliveries) delivery.local = [];
  if (want.size === 0) return;

  for (const approach of APPROACHES) {
    for (const machine of machines()) {
      const path = eventLogPath(approach, machine.name);
      if (!existsSync(path)) continue;
      const size = statSync(path).size;
      const raw = readFileSync(path, "utf8");
      const text = size > 1_000_000 ? raw.slice(-1_000_000) : raw;
      for (const line of text.split("\n")) {
        if (!line.includes("delivery")) continue;
        let record: { delivery?: unknown };
        try {
          record = JSON.parse(line) as { delivery?: unknown };
        } catch {
          continue;
        }
        if (typeof record.delivery !== "string" || !want.has(record.delivery)) continue;
        const delivery = deliveries.find((d) => d.delivery === record.delivery && d.approach === approach);
        if (delivery && !delivery.local.includes(machine.name)) delivery.local.push(machine.name);
      }
    }
  }
}

function headerOf(request: HookdeckRequest, name: string): string | undefined {
  const headers: unknown = request.headers;
  const want = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as { key?: unknown; name?: unknown; value?: unknown };
      const key = typeof rec.key === "string" ? rec.key : rec.name;
      if (typeof key === "string" && key.toLowerCase() === want && typeof rec.value === "string") {
        return rec.value;
      }
    }
    return undefined;
  }
  if (!headers || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

function pushNote(notes: string[], note: string): void {
  if (!notes.includes(note)) notes.push(note);
}

function applyOutcome(
  delivery: Delivery,
  setup: SetupState,
  events: HookdeckEvent[],
  ignored: IgnoredEvent[],
): void {
  const names = new Map<string, string>();
  for (const connection of Object.values(setup.connections)) {
    if (connection.approach === delivery.approach) names.set(connection.id, connection.name);
  }

  const lanes: LaneRecord[] = [];
  const notes: string[] = [];

  for (const event of ignored) {
    // FILTERED is the repo filter doing its job for another group, not a miss.
    if (event.cause === "FILTERED") continue;
    const connection = names.get(event.webhook_id);
    const machine = connection ? machineFromConnection(delivery.approach, connection) : undefined;
    if (machine) {
      lanes.push({ machine, outcome: "disconnected", cause: event.cause });
      pushNote(notes, `${event.cause} on ${machine}`);
    } else {
      pushNote(notes, event.cause);
    }
  }

  for (const event of events) {
    const wider = event as HookdeckEvent & { error_code?: string | null };
    const connection = names.get(event.webhook_id);
    const machine = connection ? machineFromConnection(delivery.approach, connection) : undefined;
    if (event.status === "SUCCESSFUL") {
      if (machine) lanes.push({ machine, outcome: "delivered" });
      continue;
    }
    if (event.status === "FAILED") {
      const cause = wider.error_code || "FAILED";
      if (machine) {
        lanes.push({ machine, outcome: "disconnected", cause });
        pushNote(notes, `${cause} on ${machine}`);
      } else {
        pushNote(notes, cause);
      }
    }
  }

  // A later successful delivery retires the failure for that machine. The
  // ignored CLI_DISCONNECTED row stays on the request, and a retried
  // CLI_UNAVAILABLE event can sit beside a new successful one.
  const deliveredMachines = new Set(
    lanes.filter((lane) => lane.outcome === "delivered").map((lane) => lane.machine),
  );
  const openFailures = lanes.filter(
    (lane) => lane.outcome === "disconnected" && !deliveredMachines.has(lane.machine),
  );
  delivery.hookdeckLanes = [
    ...lanes.filter((lane) => lane.outcome === "delivered"),
    ...openFailures,
  ];
  const named = openFailures
    .map((lane) => `${lane.cause ?? "FAILED"} on ${lane.machine}`)
    .filter((note, index, all) => all.indexOf(note) === index);
  // A cause that names a machine is the per-machine record. On a shared
  // connection the same failure cannot name a session, and a successful
  // delivery to any attached session is what Hookdeck shows for the request.
  if (named.length > 0) {
    delivery.callout = named.join(" · ");
    delivery.calloutTone = "bad";
    return;
  }
  if (events.some((event) => event.status === "SUCCESSFUL")) {
    delivery.callout = "delivered";
    delivery.calloutTone = "ok";
    return;
  }
  if (notes.length > 0) {
    delivery.callout = notes.join(" · ");
    delivery.calloutTone = "bad";
    return;
  }
  delivery.callout = "waiting for Hookdeck";
  delivery.calloutTone = "pending";
}

async function loadRequest(model: HookdeckRequest): Promise<HookdeckRequest> {
  const cached = requestCache.get(model.id);
  if (cached) return cached;
  if (headerOf(model, "x-github-delivery")) {
    requestCache.set(model.id, model);
    return model;
  }
  try {
    const full = await getRequest(model.id);
    requestCache.set(full.id, full);
    return full;
  } catch {
    return model;
  }
}

async function refreshHookdeck(): Promise<void> {
  const active = deliveries.filter((d) => {
    const age = Date.now() - Date.parse(d.sentAt);
    if (age > 3 * 60 * 1000) return false;
    if ((d.calloutTone === "ok" || d.calloutTone === "bad") && age > 20_000) return false;
    return true;
  });
  if (active.length === 0) return;
  const setup = readSetup();

  for (const approach of APPROACHES) {
    const mine = active.filter((d) => d.approach === approach);
    if (mine.length === 0) continue;
    const source = setup.sources[approach];
    if (!source) continue;
    const sinceMs = Math.min(...mine.map((d) => Date.parse(d.sentAt))) - 5000;
    const page = await listRequests({
      source_id: source.id,
      created_at_gte: new Date(sinceMs).toISOString(),
      limit: 30,
      dir: "desc",
    });

    for (const delivery of mine) {
      let request: HookdeckRequest | undefined;
      if (delivery.requestId) {
        const cached = requestCache.get(delivery.requestId);
        if (cached) request = cached;
        else {
          try {
            const full = await getRequest(delivery.requestId);
            requestCache.set(full.id, full);
            request = full;
          } catch {
            /* The ingest id is not visible yet. Fall through to the list. */
          }
        }
      }
      if (!request || headerOf(request, "x-github-delivery") !== delivery.delivery) {
        for (const model of page.models) {
          const full = await loadRequest(model);
          if (headerOf(full, "x-github-delivery") === delivery.delivery) {
            request = full;
            break;
          }
        }
      }
      if (!request) continue;
      delivery.requestId = request.id;
      const events = (await listEventsForRequest(request.id)).models;
      const ignored = (await listIgnoredEventsForRequest(request.id)).models;
      applyOutcome(delivery, setup, events, ignored);
    }
  }
}

function recordSend(result: SendResult, upNames: string[]): Delivery {
  const labelRepo = result.repo.split("/").pop() || result.repo;
  const delivery: Delivery = {
    delivery: result.delivery,
    approach: result.approach,
    repo: result.repo,
    event: result.event,
    color: PALETTE[colorIndex % PALETTE.length] ?? PALETTE[0] ?? "#6ea8fe",
    label: `${result.event} · ${labelRepo}`,
    sentAt: new Date().toISOString(),
    targets: targetsFor(result.repo),
    upAtSend: upNames.filter((name) => targetsFor(result.repo).includes(name)),
    requestId: result.requestId,
    local: [],
    hookdeckLanes: [],
    callout: "waiting for Hookdeck",
    calloutTone: "pending",
  };
  colorIndex += 1;
  deliveries.push(delivery);
  while (deliveries.length > 8) deliveries.shift();
  return delivery;
}

/** The machine log is the delivery. A stale FAILED event should not keep the label. */
function preferLocalReceipt(): void {
  for (const delivery of deliveries) {
    if (delivery.local.length === 0) continue;
    const got = new Set(delivery.local);
    delivery.hookdeckLanes = delivery.hookdeckLanes.filter(
      (lane) => lane.outcome !== "disconnected" || !got.has(lane.machine),
    );
    for (const machine of got) {
      if (!delivery.hookdeckLanes.some((lane) => lane.machine === machine && lane.outcome === "delivered")) {
        delivery.hookdeckLanes.push({ machine, outcome: "delivered" });
      }
    }
    const failed = delivery.hookdeckLanes.filter((lane) => lane.outcome === "disconnected");
    if (failed.length === 0 && delivery.calloutTone !== "pending") {
      delivery.callout = "delivered";
      delivery.calloutTone = "ok";
    } else if (failed.length > 0) {
      delivery.callout = failed.map((lane) => `${lane.cause ?? "FAILED"} on ${lane.machine}`).join(" · ");
      delivery.calloutTone = "bad";
    }
  }
}

async function buildState(): Promise<ReturnType<typeof snapshot>> {
  const state = snapshot();
  refreshLocal();
  if (!state.error && deliveries.length > 0) {
    try {
      await refreshHookdeck();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }
  preferLocalReceipt();
  return state;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

async function handleSetup(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const count = await runSetup();
  const noun = count === 1 ? "connection" : "connections";
  sendJson(res, 200, { ...(await buildState()), notice: `Upserted ${count} ${noun}. CLI sessions started.` });
}

async function handleTeardown(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  stopSessions();
  const deleted = await deleteAllConnections();
  clearCachedConnections();
  clearDeliveries();
  for (const connection of deleted) {
    console.log(`deleted connection ${connection.name} (${connection.id})`);
  }
  const noun = deleted.length === 1 ? "connection" : "connections";
  sendJson(res, 200, { ...(await buildState()), notice: `Stopped CLI sessions. Deleted ${deleted.length} ${noun}.` });
}

async function handleReset(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  clearDeliveries();
  const names = machines().map((m) => m.name);
  up("per-machine", names);
  up("per-group", names);
  sendJson(res, 200, await buildState());
}

async function handleFleet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asRecord(await readJson(req));
  if (!isApproach(body.approach)) throw new Error("approach must be per-machine or per-group.");
  const names = resolveNames(body.machines);
  if (body.action === "up") up(body.approach, names);
  else if (body.action === "down") down(body.approach, names);
  else if (body.action === "crash") crash(body.approach, names);
  else throw new Error("action must be up, down, or crash.");
  sendJson(res, 200, await buildState());
}

async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asRecord(await readJson(req));
  const which = body.approach;
  if (which !== "both" && !isApproach(which)) {
    throw new Error("approach must be per-machine, per-group, or both.");
  }
  const repo = typeof body.repo === "string" ? body.repo : fleet().groups[0]?.repos[0];
  if (!repo) throw new Error("No repo given and none found in fleet.yaml.");
  const known = fleet().groups.some((group) => group.repos.includes(repo));
  if (!known) throw new Error(`Repo ${repo} is not in fleet.yaml.`);
  const event = typeof body.event === "string" ? body.event : "push";
  if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}.`);

  const approaches: Approach[] = which === "both" ? [...APPROACHES] : [which];
  const running = status(APPROACHES, { quiet: true });
  for (const approach of approaches) {
    const row = running.find((item) => item.approach === approach);
    const upNames = (row?.machines ?? []).filter((m) => m.up).map((m) => m.name);
    const result = await send(approach, repo, event, 1);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Hookdeck accepted nothing for ${approach} (HTTP ${result.status}).`);
    }
    recordSend(result, upNames);
  }
  sendJson(res, 200, await buildState());
}

function serveStatic(url: URL, res: ServerResponse): void {
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const allowed = new Set(["/index.html", "/scene.js", "/per-machine.gif", "/per-group.gif"]);
  if (!allowed.has(path)) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  const file = resolve(HERE, `.${path}`);
  if (!file.startsWith(HERE) || !existsSync(file)) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  const ext = path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".gif") ? "image/gif" : "text/html; charset=utf-8";
  const body = readFileSync(file);
  res.writeHead(200, { "Content-Type": ext, "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, await buildState());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/setup") {
        await handleSetup(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/teardown") {
        await handleTeardown(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/reset") {
        await handleReset(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/fleet") {
        await handleFleet(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/send") {
        await handleSend(req, res);
        return;
      }
      if (req.method === "GET") {
        serveStatic(url, res);
        return;
      }
      sendJson(res, 405, { error: "Method not allowed." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 400, { error: message });
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fleet viz at http://127.0.0.1:${PORT}`);
});
