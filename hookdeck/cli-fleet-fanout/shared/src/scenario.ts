/**
 * Scenario runner. Each scenario is scripted end to end so it can be replayed
 * identically, and every command and its output is written to
 * evidence/<scenario>.<approach>.md for FINDINGS.md to quote.
 *
 *   npm run scenario -- list
 *   npm run scenario -- happy-path            --approach per-machine
 *   npm run scenario -- down-long             --approach per-machine
 *   npm run scenario -- down-short            --approach per-machine
 *   npm run scenario -- group-down            --approach per-group
 *   npm run scenario -- shutdown-vs-crash     --approach per-machine
 *
 * The grace window is about 2 minutes, so down-long and down-short are the
 * slow ones. Override the waits with --gap <seconds> when iterating.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, fleet, group, type Approach } from "./config.js";

const EVIDENCE = resolve(ROOT, "evidence");

/** Seconds to stay down in down-long: comfortably past the ~2m grace window. */
const PAST_GRACE = 150;
/** Seconds to stay down in down-short: comfortably inside it. */
const INSIDE_GRACE = 45;

let transcript = "";

function note(text: string): void {
  console.log(text);
  transcript += `${text}\n`;
}

function heading(text: string): void {
  note(`\n## ${text}\n`);
}

/** Run a command, echo it and its output, and capture both in the transcript. */
function run(cmd: string, args: string[]): string {
  const line = `$ ${cmd} ${args.join(" ")}`;
  console.log(`\n${line}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trimEnd();
  console.log(out);
  transcript += `\n\`\`\`console\n${line}\n${out}\n\`\`\`\n`;
  return out;
}

const npm = (args: string[]): string => run("npm", ["run", "--silent", ...args]);

async function sleep(seconds: number, why: string): Promise<void> {
  note(`_Waiting ${seconds}s: ${why}_`);
  for (let left = seconds; left > 0; left -= 15) {
    process.stdout.write(`  ${left}s remaining\r`);
    await new Promise((r) => setTimeout(r, Math.min(15, left) * 1000));
  }
  process.stdout.write("                      \r");
}

function save(name: string, approach: Approach): void {
  mkdirSync(EVIDENCE, { recursive: true });
  const path = resolve(EVIDENCE, `${name}.${approach}.md`);
  writeFileSync(path, `# Scenario: ${name} (${approach})\n\nRun at ${new Date().toISOString()}\n${transcript}`);
  console.log(`\nEvidence written to evidence/${name}.${approach}.md`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const groupA = () => group("group-a");
const dedicated = () => group("group-b");

/**
 * 1. Every machine in a group receives every event for the group's repos, and
 *    the dedicated machine receives only its own repo's events.
 */
async function happyPath(approach: Approach, gap: number): Promise<void> {
  heading("Start the whole fleet");
  npm(["fleet", "--", "up", approach]);
  await sleep(Math.min(gap, 10), "listeners to attach");

  heading(`Send a push for a group-a repo (${groupA().repos[0]})`);
  npm(["send", "--", "--approach", approach, "--repo", groupA().repos[0]!, "--event", "push"]);

  heading(`Send a push for the dedicated machine's repo (${dedicated().repos[0]})`);
  npm(["send", "--", "--approach", approach, "--repo", dedicated().repos[0]!, "--event", "push"]);

  await sleep(Math.min(gap, 10), "delivery");

  heading("Per-machine logs: who received what");
  run("bash", ["-lc", `grep -h RECV logs/${approach}.*.log | sort | tail -30`]);

  heading("Hookdeck's view of the same requests");
  npm(["inspect", "--", "--approach", approach, "--limit", "4"]);

  heading("Stop the fleet");
  npm(["fleet", "--", "down", approach]);
}

/**
 * 2 / 4. A machine (or a whole group) crashes and stays down past the grace
 *    window. Events arrive while it is gone. It comes back, and we try to
 *    recover only what it missed.
 */
async function down(
  approach: Approach,
  gap: number,
  targets: string[],
  label: string,
  downFor: number,
): Promise<void> {
  heading("Start the whole fleet");
  npm(["fleet", "--", "up", approach]);
  await sleep(Math.min(gap, 10), "listeners to attach");

  heading(`Crash ${label} (SIGKILL to the process group, so the listener dies too)`);
  npm(["fleet", "--", "crash", approach, ...targets]);
  npm(["fleet", "--", "status", approach]);

  heading(`Send 3 pushes for ${groupA().repos[0]} while ${label} is down`);
  npm([
    "send", "--", "--approach", approach, "--repo", groupA().repos[0]!,
    "--event", "push", "--count", "3", "--delay", "1000",
  ]);

  await sleep(downFor, `to pass the ~2 minute reconnect grace window`);

  heading("Hookdeck's view while the machine is still down");
  npm(["inspect", "--", "--approach", approach, "--limit", "5"]);

  heading(`What ${label} has received so far, before it comes back`);
  for (const t of targets) run("bash", ["-lc", `grep -c RECV logs/${approach}.${t}.log || true`]);

  heading(`Bring ${label} back`);
  npm(["fleet", "--", "up", approach, ...targets]);

  if (approach === "per-machine") {
    heading("Coming back runs recovery against that machine's own connection");
    await sleep(Math.min(gap, 20), "startup recovery to deliver");

    heading("Per-machine logs after coming back: the recovered machine caught up, nobody duplicated");
    run("bash", ["-lc", `for f in logs/${approach}.*.log; do echo "$f: $(grep -c RECV "$f") received"; done`]);
    run("bash", ["-lc", `grep -h RECV logs/${approach}.*.log | sort | tail -40`]);

    heading("Open question: does the request still list CLI_DISCONNECTED after a targeted retry?");
    npm(["inspect", "--", "--approach", approach, "--limit", "5"]);

    heading("Run recovery again. Events already delivered on this connection are skipped");
    for (const t of targets) npm(["recover", "--", t, "--since", sinceArg()]);
  } else {
    await sleep(Math.min(gap, 15), "the listener to reattach");
    heading("Approach 2 has no per-machine record of the miss");
    npm(["group-recovery-problem", "--", groupA().name]);

    heading("The only lever is a group retry, which duplicates to the healthy machines");
    npm(["group-recovery-problem", "--", groupA().name, "--retry"]);
  }

  heading("Stop the fleet");
  npm(["fleet", "--", "down", approach]);
}

/**
 * 3. Crash and come back inside the grace window. What happens to events that
 *    arrive during the gap is exactly what this measures.
 */
async function downShort(approach: Approach, gap: number): Promise<void> {
  const target = groupA().hosts[0]!;

  heading("Start the whole fleet");
  npm(["fleet", "--", "up", approach]);
  await sleep(Math.min(gap, 10), "listeners to attach");

  heading(`Crash ${target} and come back inside the grace window`);
  npm(["fleet", "--", "crash", approach, target]);

  heading(`Send 2 pushes while ${target} is down`);
  npm([
    "send", "--", "--approach", approach, "--repo", groupA().repos[0]!,
    "--event", "push", "--count", "2", "--delay", "1000",
  ]);

  await sleep(INSIDE_GRACE, "part of the grace window to elapse, but not all of it");

  heading(`Bring ${target} back inside the window`);
  npm(["fleet", "--", "up", approach, target]);
  await sleep(Math.min(gap, 30), "anything queued to arrive, if it does");

  heading(
    approach === "per-machine"
      ? `Did ${target} catch up? Coming back retries what this connection missed`
      : `Did ${target} receive the events sent while it was down?`,
  );
  run("bash", ["-lc", `tail -20 logs/${approach}.${target}.log`]);

  heading("Hookdeck's view: delivered, or CLI_DISCONNECTED?");
  npm(["inspect", "--", "--approach", approach, "--limit", "4"]);

  heading("Stop the fleet");
  npm(["fleet", "--", "down", approach]);
}

/** 5. Clean shutdown drops the session immediately; a crash holds it. */
async function shutdownVsCrash(approach: Approach, gap: number): Promise<void> {
  const [clean, crashed] = [groupA().hosts[0]!, groupA().hosts[1]!];

  heading("Start the whole fleet");
  npm(["fleet", "--", "up", approach]);
  await sleep(Math.min(gap, 10), "listeners to attach");

  heading(`Clean shutdown of ${clean} (SIGTERM -> SIGINT -> WebSocket 1000 close)`);
  npm(["fleet", "--", "down", approach, clean]);

  heading(`Crash of ${crashed} (SIGKILL, no close frame)`);
  npm(["fleet", "--", "crash", approach, crashed]);

  heading("Send immediately, while the crashed session should still be held");
  npm(["send", "--", "--approach", approach, "--repo", groupA().repos[0]!, "--event", "push"]);
  await sleep(Math.min(gap, 20), "delivery to be attempted");

  heading("Hookdeck's view: the cleanly stopped machine should show CLI_DISCONNECTED");
  npm(["inspect", "--", "--approach", approach, "--limit", "3"]);

  heading(`Now wait out the grace window and send again`);
  await sleep(PAST_GRACE, "the held session to expire");
  npm(["send", "--", "--approach", approach, "--repo", groupA().repos[0]!, "--event", "push"]);
  await sleep(Math.min(gap, 20), "delivery to be attempted");

  heading("Hookdeck's view: both should now show CLI_DISCONNECTED");
  npm(["inspect", "--", "--approach", approach, "--limit", "3"]);

  heading("Stop the fleet");
  npm(["fleet", "--", "down", approach]);
}

/** A --since bound wide enough to cover a single scenario run. */
const startedAt = new Date(Date.now() - 60_000).toISOString();
const sinceArg = (): string => startedAt;

// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, { summary: string; run: (a: Approach, gap: number) => Promise<void> }> = {
  "happy-path": {
    summary: "Every machine in a group gets every matching event; the dedicated machine gets only its own",
    run: happyPath,
  },
  "down-long": {
    summary: "One machine crashes and stays down past the grace window, then recovers what it missed",
    run: (a, gap) => down(a, gap, [groupA().hosts[0]!], groupA().hosts[0]!, PAST_GRACE),
  },
  "down-short": {
    summary: "One machine crashes and returns inside the grace window - what happens to events in the gap",
    run: downShort,
  },
  "group-down": {
    summary: "The whole group is down, then every machine recovers independently",
    run: (a, gap) =>
      down(a, gap, groupA().hosts, groupA().name, PAST_GRACE),
  },
  "shutdown-vs-crash": {
    summary: "Clean shutdown drops the session immediately; a crash holds it for the grace window",
    run: shutdownVsCrash,
  },
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { approach: { type: "string", default: "per-machine" }, gap: { type: "string" } },
  });
  const name = positionals[0];

  if (!name || name === "list") {
    console.log(`\nScenarios (fleet prefix "${fleet().prefix}"):\n`);
    for (const [key, s] of Object.entries(SCENARIOS)) console.log(`  ${key.padEnd(20)} ${s.summary}`);
    console.log(`\nnpm run scenario -- <name> --approach <per-machine|per-group>\n`);
    return;
  }

  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario ${name}. Run \`npm run scenario -- list\`.`);
  const approach = values.approach as Approach;
  const gap = values.gap ? Number(values.gap) : 15;

  note(`# ${name} (${approach})`);
  note(`\n${scenario.summary}\n`);
  try {
    await scenario.run(approach, gap);
  } finally {
    save(name, approach);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
