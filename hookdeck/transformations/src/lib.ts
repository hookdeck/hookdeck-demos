/**
 * Hookdeck setup through the API, the local receiver, the CLI listener, and
 * sending an example's input.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Example, Input } from "./examples.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_DIR = resolve(ROOT, "run");
const CLI_CONFIG = resolve(RUN_DIR, "hookdeck-cli.toml");

loadEnv(resolve(ROOT, ".env"));

const API_KEY = process.env.HOOKDECK_API_KEY;
export const API_BASE = process.env.HOOKDECK_API_BASE || "https://api.hookdeck.com/2026-09-01";
export const HOOKDECK_CLI = process.env.HOOKDECK_CLI || bundledCli();
export const PORT = Number(process.env.PORT || 4400);

// One CLI destination shared by every example's connection
const DESTINATION = "local-transformations";
const RECEIVE_PATH = "/receive";
export const PREFIX = "transformations-";

export interface Resources {
  sourceName: string;
  sourceUrl: string;
  connectionId: string;
  transformationId: string;
}

export interface Received {
  body: Buffer;
  contentType: string;
  headers: Record<string, string | string[] | undefined>;
}

function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

/**
 * The CLI is an npm dependency, so the demo runs a known version. Resolve the
 * platform binary directly rather than node_modules/.bin/hookdeck: that
 * wrapper runs it with execFileSync, which forwards no signals, so stopping
 * `listen` would kill it instead of shutting it down cleanly.
 */
function bundledCli(): string {
  const arch = ({ x64: "amd64", arm64: "arm64", ia32: "386" } as Record<string, string>)[process.arch] ?? process.arch;
  const name = process.platform === "win32" ? "hookdeck.exe" : "hookdeck";
  const direct = resolve(ROOT, `node_modules/hookdeck-cli/binaries/${process.platform}-${arch}/${name}`);
  return existsSync(direct) ? direct : resolve(ROOT, "node_modules/.bin/hookdeck");
}

export function requireApiKey(): void {
  if (!API_KEY) {
    console.error("HOOKDECK_API_KEY is not set. Copy .env.example to .env and add a project API key.");
    process.exit(1);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export function cliVersion(): string {
  return spawnSync(HOOKDECK_CLI, ["version"], { encoding: "utf8" }).stdout.split("\n")[0] || "unknown";
}

export const codeOf = (example: Example): string =>
  readFileSync(resolve(ROOT, "transformations", `${example.id}.js`), "utf8");

/**
 * Upserts the example's transformation (code and environment variables), then
 * its source and the connection from it to the CLI destination with the
 * transformation as a rule. Idempotent, and pushes any edits to the code.
 */
export async function setup(example: Example): Promise<Resources> {
  const name = PREFIX + example.id;
  const transformation = await api<{ id: string }>("PUT", "/transformations", {
    name,
    code: codeOf(example),
    env: example.env ?? {},
  });
  const connection = await api<{ id: string; source: { name: string; url: string } }>("PUT", "/connections", {
    name,
    source: { name, type: "WEBHOOK" },
    destination: { name: DESTINATION, type: "CLI", config: { path: RECEIVE_PATH } },
    rules: [{ type: "transform", transformation_id: transformation.id }],
  });
  return {
    sourceName: connection.source.name,
    sourceUrl: connection.source.url,
    connectionId: connection.id,
    transformationId: transformation.id,
  };
}

type Handler = (req: IncomingMessage, res: ServerResponse) => boolean;

/**
 * Records what arrives at /receive, keyed by the `run` query parameter. Any
 * other request goes to `handler` (the UI), which returns false for a 404.
 */
export function startReceiver(onReceive: (run: string, received: Received) => void, handler?: Handler): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname !== RECEIVE_PATH) {
      if (!handler?.(req, res)) {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const run = url.searchParams.get("run");
      const body = Buffer.concat(chunks);
      if (run) onReceive(run, { body, contentType: req.headers["content-type"] || "", headers: req.headers });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: run, bytes: body.length }));
    });
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

/** Logs the CLI in to the API key's project in a config file of its own, then listens to the sources. */
export function startListener(sources: string[]): Promise<ChildProcess> {
  mkdirSync(RUN_DIR, { recursive: true });
  const login = spawnSync(HOOKDECK_CLI, ["ci", "--api-key", API_KEY!, "--hookdeck-config", CLI_CONFIG], {
    encoding: "utf8",
  });
  if (login.status !== 0) throw new Error(`hookdeck ci failed:\n${login.stdout}${login.stderr}`);

  const child = spawn(
    HOOKDECK_CLI,
    ["listen", String(PORT), sources.join(","), "--output", "compact", "--hookdeck-config", CLI_CONFIG],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`hookdeck listen did not connect:\n${log}`)), 30_000);
    const onData = (data: Buffer) => {
      log += data.toString();
      if (log.includes("Connected")) {
        clearTimeout(timer);
        ok(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => fail(new Error(`hookdeck listen exited (${code}):\n${log}`)));
  });
}

/** POSTs an input to the example's source, tagged with `run` so the delivery can be matched. */
export async function send(sourceUrl: string, input: Input, run: string): Promise<string | undefined> {
  const url = new URL(sourceUrl);
  url.searchParams.set("run", run);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": input.contentType, ...input.headers },
    body: input.body,
  });
  const json = (await res.json().catch(() => ({}))) as { request_id?: string };
  return json.request_id;
}

/** Ingestion answers 200 even when it rejects a request, so ask the API. */
export async function ingestionOutcome(requestId: string | undefined): Promise<string> {
  if (!requestId) return "no request id";
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const request = await api<{ rejection_cause?: string | null }>("GET", `/requests/${requestId}`);
      return request.rejection_cause ? `rejected: ${request.rejection_cause}` : "accepted";
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return "unknown";
}

export interface Execution {
  id: string;
  log_level: string;
  logs: { type?: string; message?: string }[];
  created_at: string;
  issue_id?: string | null;
}

/** The transformation's execution for this connection since `since`, with its console output. */
export async function execution(r: Resources, since: number): Promise<Execution | undefined> {
  const query = new URLSearchParams({
    webhook_id: r.connectionId,
    "created_at[gte]": new Date(since - 5000).toISOString(),
    order_by: "created_at",
    dir: "desc",
    limit: "1",
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const page = await api<{ models: Execution[] }>("GET", `/transformations/${r.transformationId}/executions?${query}`).catch(() => undefined);
    if (page?.models[0]) return page.models[0];
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return undefined;
}
