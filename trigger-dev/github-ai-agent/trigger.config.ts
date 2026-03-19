import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { config as loadDotenv } from "dotenv";

/**
 * Env vars consumed by tasks at runtime. Synced from `.env` → Trigger.dev Production on each
 * `npm run deploy` (see syncEnvVars below). Do not add Hookdeck or TRIGGER_SECRET_KEY here.
 *
 * `deploy:prod` uses `--env-file .env` so the CLI hydrates `process.env` before this config runs.
 * We also call `loadDotenv` here so sync still works if deploy is invoked without that flag.
 */
/** Keys stored in Trigger.dev / available in tasks at runtime (one name per secret — no duplicates). */
const TASK_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "GITHUB_ACCESS_TOKEN",
  "GITHUB_LABELS",
  "SLACK_WEBHOOK_URL",
] as const;

function configFileDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Prefer repo root (cwd), then folder containing this config file. */
function resolveDotenvPath(): string | undefined {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(configFileDir(), ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Load `.env` into `process.env` (does not override existing env vars).
 * If an older `.env` only defines `GITHUB_TOKEN`, copy it to `GITHUB_ACCESS_TOKEN` for sync
 * (some UIs don’t persist `GITHUB_TOKEN` reliably; `GITHUB_ACCESS_TOKEN` is explicit).
 */
function readTaskEnv(): Record<string, string | undefined> {
  const dotenvPath = resolveDotenvPath();
  if (dotenvPath) {
    loadDotenv({ path: dotenvPath });
  }
  const access = process.env.GITHUB_ACCESS_TOKEN?.trim();
  const legacy = process.env.GITHUB_TOKEN?.trim();
  if (!access && legacy) {
    process.env.GITHUB_ACCESS_TOKEN = legacy;
  }
  const out: Record<string, string | undefined> = {};
  for (const key of TASK_ENV_KEYS) {
    const v = process.env[key];
    out[key] = v === "" ? undefined : v;
  }
  return out;
}

export default defineConfig({
  // Replace with your Trigger.dev project ref from the dashboard
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./trigger"],
  maxDuration: 120, // seconds — generous limit for LLM calls
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      syncEnvVars(async () => {
        const env = readTaskEnv();
        const missing: string[] = [];
        if (!env.ANTHROPIC_API_KEY?.trim()) missing.push("ANTHROPIC_API_KEY");
        if (!env.GITHUB_ACCESS_TOKEN?.trim()) {
          missing.push(
            "GITHUB_ACCESS_TOKEN (or legacy GITHUB_TOKEN in .env)",
          );
        }
        if (missing.length) {
          const hint = resolveDotenvPath()
            ? `Found .env at ${resolveDotenvPath()} but ${missing.join(", ")} empty/missing.`
            : `No .env found (looked in ${process.cwd()} and ${configFileDir()}).`;
          throw new Error(
            `[trigger.config] Missing ${missing.join(", ")} for task sync. ${hint} Add GITHUB_ACCESS_TOKEN to .env or set in Trigger.dev → Environment variables → Production. Deploy with: npm run deploy (uses --env-file .env).`,
          );
        }
        const synced: Record<string, string> = {};
        for (const key of TASK_ENV_KEYS) {
          const value = env[key]?.trim();
          if (value) synced[key] = value;
        }
        return synced;
      }),
    ],
  },
});
