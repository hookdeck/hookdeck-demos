/**
 * Sends one fixture per content type to a Hookdeck source and checks what a
 * CLI listener receives. For each case it records:
 *
 *   ingestion  - did Hookdeck accept the request, or reject it (and why)
 *   delivered  - did the bytes reach the local receiver via `hookdeck listen`
 *   exact      - does the SHA-256 of what arrived match what was sent
 *   received   - the Content-Type the receiver saw
 *
 * Usage: npm test            (all cases)
 *        npm test -- mp3 png (only these case ids)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cases } from "./cases.js";
import {
  API_BASE,
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

const RESULTS_DIR = resolve(ROOT, "results");
const DELIVERY_TIMEOUT_MS = 30_000;

interface Result {
  id: string;
  contentType: string;
  note?: string;
  bytes: number;
  requestId?: string;
  ingestion: string;
  delivered: boolean;
  exact: boolean;
  receivedContentType?: string;
  receivedHeaders?: Record<string, string | string[] | undefined>;
}

async function waitFor(received: Map<string, Received>, ids: string[]): Promise<void> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline && ids.some((id) => !received.has(id))) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

function table(results: Result[]): string {
  const rows = results.map((r) => [
    r.id,
    r.contentType.split(";")[0],
    r.ingestion,
    r.delivered ? "yes" : "no",
    r.delivered ? (r.exact ? "✅ yes" : "❌ no") : "-",
    r.receivedContentType?.split(";")[0] || "-",
    r.note || "",
  ]);
  const header = ["case", "sent as", "ingestion", "delivered", "byte-exact", "received as", "note"];
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

async function main(): Promise<void> {
  requireApiKey();

  const only = process.argv.slice(2);
  const selected = cases().filter((c) => only.length === 0 || only.includes(c.id));

  const version = cliVersion();
  console.log(`CLI: ${HOOKDECK_CLI} (${version})`);

  const sourceUrl = await setup();
  console.log(`Source: ${sourceUrl}`);

  const received = new Map<string, Received>();
  const server = await startReceiver((id, r) => received.set(id, r));
  const listener = await startListener();
  console.log(`Listening on :${PORT}, sending ${selected.length} cases...\n`);

  try {
    const sent = await Promise.all(selected.map(async (c) => ({ c, requestId: await send(sourceUrl, c) })));
    await waitFor(received, selected.map((c) => c.id));

    const results: Result[] = [];
    for (const { c, requestId } of sent) {
      const got = received.get(c.id);
      results.push({
        id: c.id,
        contentType: c.contentType,
        note: c.note,
        bytes: c.body.length,
        requestId,
        ingestion: await ingestionOutcome(requestId),
        delivered: !!got,
        exact: !!got && got.sha256 === sha256(c.body),
        receivedContentType: got?.contentType,
        receivedHeaders: got?.headers,
      });
    }

    const markdown = table(results);
    console.log(markdown);

    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    writeFileSync(
      resolve(RESULTS_DIR, "latest.json"),
      JSON.stringify({ runAt: stamp, cli: version, apiBase: API_BASE, results }, null, 2),
    );
    writeFileSync(resolve(RESULTS_DIR, "latest.md"), `Run at ${stamp}, CLI ${version}\n\n${markdown}\n`);
    console.log(`\nWrote results/latest.json and results/latest.md`);
  } finally {
    listener.kill("SIGINT");
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
