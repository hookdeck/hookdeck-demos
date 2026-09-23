/**
 * Post GitHub-shaped webhooks to a demo source, signed with the source's
 * webhook secret so that verification runs exactly as it would in production.
 *
 *   npm run send -- --approach per-machine --repo demo-org/service-api
 *   npm run send -- --approach both --repo demo-org/release-tooling --event push --count 3
 *
 * Every send is recorded in logs/sent.jsonl with a sha256 of the exact bytes
 * posted, so the forwarded body can be compared byte for byte against it.
 */
import { createHmac, createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ROOT, env, fleet, runDir, type Approach } from "./config.js";

interface SetupState {
  sources: Record<string, { id: string; name: string; url: string }>;
}

function setupState(): SetupState {
  const path = resolve(runDir(), "setup.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SetupState;
  } catch {
    throw new Error(`run/setup.json not found. Run \`npm run setup\` first.`);
  }
}

function payload(repo: string, event: string, delivery: string): unknown {
  const [owner = "demo-org", name = "repo"] = repo.split("/");
  const base = {
    repository: {
      id: Math.abs(hashToInt(repo)),
      name,
      full_name: repo,
      private: true,
      owner: { login: owner, type: "Organization" },
      default_branch: "main",
    },
    sender: { login: "demo-user", type: "User" },
    organization: { login: owner },
    // Not a GitHub field. Carried through so a viewer can tie a log line back
    // to the exact send without reading headers.
    _demo: { delivery, sentAt: new Date().toISOString() },
  };

  switch (event) {
    case "pull_request":
      return {
        ...base,
        action: "opened",
        number: 42,
        pull_request: { number: 42, title: "Bump toolchain", state: "open", merged: false },
      };
    case "workflow_run":
      return {
        ...base,
        action: "completed",
        workflow_run: { id: 99001, name: "build", status: "completed", conclusion: "success" },
      };
    case "push":
    default:
      return {
        ...base,
        ref: "refs/heads/main",
        before: "0".repeat(40),
        after: hashToHex(delivery),
        commits: [{ id: hashToHex(delivery), message: `demo commit ${delivery.slice(0, 8)}` }],
        head_commit: { id: hashToHex(delivery), message: `demo commit ${delivery.slice(0, 8)}` },
      };
  }
}

const hashToHex = (s: string): string => createHash("sha1").update(s).digest("hex");
const hashToInt = (s: string): number => parseInt(createHash("sha1").update(s).digest("hex").slice(0, 8), 16);

export interface SendResult {
  approach: Approach;
  repo: string;
  event: string;
  delivery: string;
  status: number;
  requestId?: string;
}

export async function send(
  approach: Approach,
  repo: string,
  event: string,
  index: number,
): Promise<SendResult> {
  const url = setupState().sources[approach]?.url;
  if (!url) throw new Error(`No source URL for ${approach} in run/setup.json. Re-run \`npm run setup\`.`);

  const delivery = randomUUID();
  // Sign the exact bytes that go on the wire.
  const body = Buffer.from(JSON.stringify(payload(repo, event, delivery)), "utf8");
  const signature = `sha256=${createHmac("sha256", env("GITHUB_WEBHOOK_SECRET")).update(body).digest("hex")}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "GitHub-Hookshot/demo",
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": delivery,
    "X-GitHub-Hook-ID": "100000000",
    "X-Hub-Signature-256": signature,
  };

  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  let requestId: string | undefined;
  try {
    const parsed = JSON.parse(text) as { request_id?: unknown; id?: unknown };
    const candidate = parsed.request_id ?? parsed.id;
    if (typeof candidate === "string" && candidate.length > 0) requestId = candidate;
  } catch {
    /* The ingest response is not always JSON. Header matching still works. */
  }

  mkdirSync(resolve(ROOT, "logs"), { recursive: true });
  appendFileSync(
    resolve(ROOT, "logs", "sent.jsonl"),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      approach,
      repo,
      event,
      delivery,
      index,
      bodyBytes: body.length,
      bodySha256: createHash("sha256").update(body).digest("hex"),
      signature,
      status: res.status,
      response: text.slice(0, 200),
    })}\n`,
  );

  console.log(
    `SENT ${approach.padEnd(12)} ${event.padEnd(13)} ${repo.padEnd(26)} ` +
      `delivery=${delivery} -> ${res.status}`,
  );

  return { approach, repo, event, delivery, status: res.status, requestId };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      event: { type: "string", default: "push" },
      count: { type: "string", default: "1" },
      delay: { type: "string", default: "250" },
      approach: { type: "string", default: "both" },
    },
  });
  const repo = values.repo ?? fleet().groups[0]?.repos[0];
  const event = values.event;
  const count = Number(values.count);
  const delayMs = Number(values.delay);
  const which = values.approach;
  if (!repo) throw new Error("No repo given and none found in fleet.yaml");

  const approaches: Approach[] =
    which === "both" ? ["per-machine", "per-group"] : [which as Approach];

  for (let i = 1; i <= count; i++) {
    for (const approach of approaches) await send(approach, repo, event, i);
    if (i < count) await new Promise((r) => setTimeout(r, delayMs));
  }
}

function launchedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (launchedAsCli()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
