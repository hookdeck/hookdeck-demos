/**
 * A local UI that sends each example's input to its source and follows the
 * event: ingestion, the transformation's execution and console output,
 * delivery through `hookdeck listen` to this server, a check of what arrived,
 * and the result rendered.
 *
 * Usage: npm start, then open http://localhost:4400
 */
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { basename, extname, resolve, sep } from "node:path";
import {
  HOOKDECK_CLI,
  PORT,
  ROOT,
  cliVersion,
  codeOf,
  execution,
  ingestionOutcome,
  requireApiKey,
  send,
  setup,
  startListener,
  startReceiver,
  type Received,
  type Resources,
} from "./lib.js";
import { examples } from "./examples.js";

const PAGE = resolve(ROOT, "public/index.html");
// The Hookdeck design system's CSS and the assets it references
const DS_DIR = resolve(ROOT, "public/ds");
const STATIC_TYPES: Record<string, string> = { ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

// Headers worth showing on the delivered request; the rest is proxy noise
const SHOWN_HEADERS = ["content-type", "content-length", "content-encoding", "x-signature"];

const byId = new Map(examples.map((e) => [e.id, e]));

/** Media elements need Content-Length and byte ranges to load and seek. */
function serveBytes(range: string | undefined, res: ServerResponse, data: Buffer, contentType: string): void {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    if (start > end || start >= data.length) {
      res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${data.length}`,
      "Accept-Ranges": "bytes",
    });
    res.end(data.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": data.length, "Accept-Ranges": "bytes" });
  res.end(data);
}

async function main(): Promise<void> {
  requireApiKey();

  const version = cliVersion();
  console.log("Upserting sources, transformations and connections…");
  const resources = new Map<string, Resources>();
  for (const example of examples) resources.set(example.id, await setup(example));

  // What arrived, keyed by run: `${exampleId}.${inputIndex}.${nonce}`
  const received = new Map<string, Received>();
  const sentAt = new Map<string, number>();

  const clients = new Set<ServerResponse>();
  const broadcast = (event: unknown) => {
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  let listener: ChildProcess | undefined;
  let listenerState: "connecting" | "connected" | "stopped" = "connecting";
  const setListenerState = (state: typeof listenerState) => {
    listenerState = state;
    broadcast({ type: "listener", state });
  };
  const connect = async () => {
    setListenerState("connecting");
    listener = await startListener([...resources.values()].map((r) => r.sourceName));
    listener.on("exit", () => setListenerState("stopped"));
    setListenerState("connected");
  };

  const parseRun = (run: string) => {
    const [id, index] = run.split(".");
    const example = id ? byId.get(id) : undefined;
    const input = example?.inputs[Number(index)];
    return example && input ? { example, input } : undefined;
  };

  const onReceive = (run: string, r: Received) => {
    const parsed = parseRun(run);
    if (!parsed) return;
    received.set(run, r);
    const started = sentAt.get(run);
    const headers = Object.fromEntries(SHOWN_HEADERS.filter((h) => r.headers[h]).map((h) => [h, String(r.headers[h])]));
    broadcast({
      type: "delivered",
      run,
      contentType: r.contentType,
      bytes: r.body.length,
      headers,
      check: parsed.example.check(r.body, r.headers, parsed.input),
      text: r.contentType.startsWith("application/json") ? r.body.toString("utf8").slice(0, 4000) : undefined,
      eventId: r.headers["x-hookdeck-eventid"],
      eventUrl: r.headers["x-hookdeck-event-url"],
      ms: started ? Date.now() - started : undefined,
    });
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = await startReceiver(onReceive, (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(PAGE));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/theme.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(readFileSync(resolve(ROOT, "public/theme.js")));
      return true;
    }

    // highlight.js's browser build, for the transformation code
    if (req.method === "GET" && url.pathname === "/vendor/highlight.min.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(readFileSync(resolve(ROOT, "node_modules/@highlightjs/cdn-assets/highlight.min.js")));
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/ds/")) {
      const path = resolve(DS_DIR, decodeURIComponent(url.pathname.slice("/ds/".length)));
      const type = STATIC_TYPES[extname(path)];
      if (!path.startsWith(DS_DIR + sep) || !type || !existsSync(path)) return false;
      res.writeHead(200, { "Content-Type": type });
      res.end(readFileSync(path));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/examples") {
      json(res, 200, {
        cli: `${basename(HOOKDECK_CLI)} (${version.replace("hookdeck version ", "")})`,
        listener: listenerState,
        examples: examples.map((e) => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          modules: e.modules,
          code: codeOf(e),
          env: Object.keys(e.env ?? {}),
          sourceUrl: resources.get(e.id)?.sourceUrl,
          connectionId: resources.get(e.id)?.connectionId,
          inputs: e.inputs.map((input) => ({
            label: input.label,
            contentType: input.contentType,
            headers: input.headers ?? {},
            bytes: input.body.length,
            text: input.display ?? input.body.toString("utf8"),
            encoded: input.display !== undefined,
          })),
        })),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/listener") {
      const want = url.searchParams.get("state");
      if (want === "stopped" && listener) {
        listener.kill("SIGINT");
        listener = undefined;
      } else if (want === "connected" && !listener) {
        void connect().catch((error) => {
          console.error(error);
          setListenerState("stopped");
        });
      }
      json(res, 202, { requested: want });
      return true;
    }

    // The delivered bytes, served as their content type so the browser renders them
    const raw = url.pathname.match(/^\/api\/raw\/([a-z0-9.-]+)$/);
    if (req.method === "GET" && raw?.[1]) {
      const r = received.get(raw[1]);
      if (!r) return false;
      serveBytes(req.headers.range, res, r.body, r.contentType.split(";")[0] || "application/octet-stream");
      return true;
    }

    const sendMatch = url.pathname.match(/^\/api\/send\/([a-z0-9-]+)\/(\d+)$/);
    if (req.method === "POST" && sendMatch?.[1] && sendMatch[2]) {
      const example = byId.get(sendMatch[1]);
      const r = resources.get(sendMatch[1]);
      const input = example?.inputs[Number(sendMatch[2])];
      if (!example || !r || !input) return false;
      const run = `${example.id}.${sendMatch[2]}.${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      json(res, 202, { run });

      void (async () => {
        const started = Date.now();
        sentAt.set(run, started);
        const requestId = await send(r.sourceUrl, input, run);
        broadcast({ type: "sent", run, requestId });
        const ingestion = await ingestionOutcome(requestId);
        broadcast({ type: "ingestion", run, ingestion });
        if (ingestion !== "accepted") return;
        const e = await execution(r, started);
        broadcast({
          type: "execution",
          run,
          execution: e ? { id: e.id, level: e.log_level, logs: e.logs, issueId: e.issue_id } : null,
        });
      })().catch((error) => broadcast({ type: "error", run, error: String(error) }));
      return true;
    }

    return false;
  });

  await connect();
  console.log(`CLI: ${HOOKDECK_CLI} (${version})`);
  console.log(`\nOpen http://localhost:${PORT}`);

  const stop = () => {
    listener?.kill("SIGINT");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
