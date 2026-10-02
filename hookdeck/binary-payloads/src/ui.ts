/**
 * A local UI for sending cases one at a time and watching what happens:
 * ingestion outcome, delivery through `hookdeck listen`, whether the bytes
 * match, and a preview of what arrived. Serves on the same port as the
 * receiver.
 *
 * Usage: npm run ui, then open http://localhost:4300
 */
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { basename, extname, resolve, sep } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { cases, type Case } from "./cases.js";
import {
  HOOKDECK_CLI,
  PORT,
  ROOT,
  cliVersion,
  ingestionOutcome,
  requireApiKey,
  send,
  setup,
  sha256,
  startListener,
  startReceiver,
  type Received,
} from "./lib.js";

const PAGE = resolve(ROOT, "public/index.html");
// The Hookdeck design system's CSS and the assets it references
const DS_DIR = resolve(ROOT, "public/ds");
const STATIC_TYPES: Record<string, string> = { ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

function kind(c: Case): string {
  if (c.query) return "override";
  if (c.offList) return "off-list";
  if (c.note === "control") return "text";
  return "allowlist";
}

// --- Previews -------------------------------------------------------------

interface Entry {
  name: string;
  contentType: string;
  bytes: number;
  data: Buffer;
}

const isUtf8 = (buf: Buffer): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
};

function hexDump(buf: Buffer, max = 256): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(buf.length, max); i += 16) {
    const slice = buf.subarray(i, Math.min(i + 16, buf.length, max));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(6, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (buf.length > max) lines.push(`… ${buf.length - max} more bytes`);
  return lines.join("\n");
}

const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
};
const typeOf = (name: string) => TYPES[name.split(".").pop() || ""] || "application/octet-stream";

function multipartEntries(body: Buffer, contentType: string): Entry[] {
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const entries: Entry[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString();
    const data = part.subarray(split + 4);
    const name = head.match(/filename="([^"]+)"/)?.[1] || head.match(/name="([^"]+)"/)?.[1] || "part";
    const type = head.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "text/plain";
    entries.push({ name, contentType: type, bytes: data.length, data });
    start = next;
  }
  return entries;
}

function zipEntries(body: Buffer): Entry[] {
  const entries: Entry[] = [];
  let i = 0;
  while (i + 30 <= body.length && body.readUInt32LE(i) === 0x04034b50) {
    const method = body.readUInt16LE(i + 8);
    const compressed = body.readUInt32LE(i + 18);
    const nameLength = body.readUInt16LE(i + 26);
    const extraLength = body.readUInt16LE(i + 28);
    const name = body.subarray(i + 30, i + 30 + nameLength).toString();
    const start = i + 30 + nameLength + extraLength;
    const raw = body.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    entries.push({ name, contentType: typeOf(name), bytes: data.length, data });
    i = start + compressed;
  }
  return entries;
}

function tarEntries(body: Buffer): Entry[] {
  const entries: Entry[] = [];
  let i = 0;
  while (i + 512 <= body.length && body[i] !== 0) {
    const name = body.subarray(i, i + 100).toString().replace(/\0.*$/s, "");
    const size = parseInt(body.subarray(i + 124, i + 136).toString().replace(/\0.*$/s, "").trim(), 8);
    const data = body.subarray(i + 512, i + 512 + size);
    entries.push({ name, contentType: typeOf(name), bytes: size, data });
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function gzipEntries(body: Buffer): Entry[] {
  const data = gunzipSync(body);
  const isWav = data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WAVE";
  const contentType = isWav ? "audio/wav" : isUtf8(data) ? "text/plain" : "application/octet-stream";
  return [{ name: isWav ? "decompressed.wav" : "decompressed", contentType, bytes: data.length, data }];
}

function entries(c: Case, body: Buffer): Entry[] {
  try {
    if (c.preview === "multipart") return multipartEntries(body, c.contentType);
    if (c.preview === "zip") return zipEntries(body);
    if (c.preview === "tar") return tarEntries(body);
    if (c.preview === "gzip") return gzipEntries(body);
  } catch {
    // A body that doesn't parse gets the hex dump only
  }
  return [];
}

/** Describes what arrived; the page fetches media from /api/raw. */
function describe(c: Case, body: Buffer) {
  return {
    preview: c.preview,
    // What the bytes really are, which the override hides from the receiver
    realType: c.contentType.split(";")[0],
    utf8: isUtf8(body),
    hex: hexDump(body),
    text: c.preview === "text" && isUtf8(body) ? body.toString("utf8") : undefined,
    entries: entries(c, body).map((e, index) => ({
      index,
      name: e.name,
      contentType: e.contentType,
      bytes: e.bytes,
      text: e.contentType.startsWith("text/") ? e.data.toString("utf8").slice(0, 2000) : undefined,
    })),
  };
}

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

// --- Server ---------------------------------------------------------------

async function main(): Promise<void> {
  requireApiKey();

  const all = cases();
  const byId = new Map(all.map((c) => [c.id, c]));
  const version = cliVersion();
  const sourceUrl = await setup();

  // Bodies as they arrived, keyed by `${id}.${run}`
  const bodies = new Map<string, Buffer>();
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
    listener = await startListener();
    listener.on("exit", () => setListenerState("stopped"));
    setListenerState("connected");
  };

  const onReceive = (key: string, r: Received) => {
    const [id, run] = key.split(".");
    const c = id ? byId.get(id) : undefined;
    if (!c || !run) return;
    bodies.set(key, r.body);
    const started = sentAt.get(key);
    broadcast({
      type: "delivered",
      id,
      run,
      exact: r.sha256 === sha256(c.body),
      bytes: r.bytes,
      contentType: r.contentType,
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

    if (req.method === "GET" && url.pathname.startsWith("/ds/")) {
      const path = resolve(DS_DIR, decodeURIComponent(url.pathname.slice("/ds/".length)));
      const type = STATIC_TYPES[extname(path)];
      if (!path.startsWith(DS_DIR + sep) || !type || !existsSync(path)) return false;
      res.writeHead(200, { "Content-Type": type });
      res.end(readFileSync(path));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/cases") {
      json(res, 200, {
        sourceUrl,
        cli: `${basename(HOOKDECK_CLI)} (${version.replace("hookdeck version ", "")})`,
        listener: listenerState,
        cases: all.map((c) => ({
          id: c.id,
          contentType: c.contentType.split(";")[0],
          bytes: c.body.length,
          note: c.note,
          kind: kind(c),
          utf8: isUtf8(c.body),
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

    const preview = url.pathname.match(/^\/api\/preview\/([a-z0-9-]+)\/([a-f0-9]+)$/);
    if (req.method === "GET" && preview?.[1] && preview[2]) {
      const c = byId.get(preview[1]);
      const body = bodies.get(`${preview[1]}.${preview[2]}`);
      if (!c || !body) return false;
      json(res, 200, describe(c, body));
      return true;
    }

    // The received bytes (or one entry), served as their real type so the browser can render them
    const raw = url.pathname.match(/^\/api\/raw\/([a-z0-9-]+)\/([a-f0-9]+)$/);
    if (req.method === "GET" && raw?.[1] && raw[2]) {
      const c = byId.get(raw[1]);
      const body = bodies.get(`${raw[1]}.${raw[2]}`);
      if (!c || !body) return false;
      const index = url.searchParams.get("entry");
      const entry = index === null ? undefined : entries(c, body)[Number(index)];
      serveBytes(req.headers.range, res, entry ? entry.data : body, entry ? entry.contentType : c.contentType.split(";")[0] || c.contentType);
      return true;
    }

    const sendMatch = url.pathname.match(/^\/api\/send\/([a-z0-9-]+)$/);
    if (req.method === "POST" && sendMatch?.[1]) {
      const c = byId.get(sendMatch[1]);
      if (!c) return false;
      const run = randomUUID().replace(/-/g, "").slice(0, 8);
      json(res, 202, { id: c.id, run });

      void (async () => {
        sentAt.set(`${c.id}.${run}`, Date.now());
        const requestId = await send(sourceUrl, c, run);
        broadcast({ type: "sent", id: c.id, run, requestId });
        const ingestion = await ingestionOutcome(requestId);
        broadcast({ type: "ingestion", id: c.id, run, requestId, ingestion });
      })().catch((error) => broadcast({ type: "error", id: c.id, run, error: String(error) }));
      return true;
    }

    return false;
  });

  await connect();
  console.log(`Source: ${sourceUrl}`);
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
