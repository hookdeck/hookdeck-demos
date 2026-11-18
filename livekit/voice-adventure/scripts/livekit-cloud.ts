/**
 * Creates the LiveKit Cloud webhook that points at the Hookdeck source, through LiveKit Cloud's
 * management API (the same API `lk project webhook` uses; it is on LiveKit's `beta-api` host).
 *
 * The API takes a user session, not an API key and secret. The session comes from
 * `lk cloud auth --user-auth`, which stores it in ~/.livekit/cli-config.yaml, or from
 * LIVEKIT_SESSION_TOKEN. Without one the caller prints the dashboard steps instead.
 *
 * https://docs.livekit.io/reference/api/projects/webhooks/
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

export const DEFAULT_API_URL = 'https://beta-api.livekit.cloud';
export const WEBHOOK_NAME = 'Hookdeck: livekit-voice-adventure';
/** The name this demo used before it was renamed: that webhook is moved to the new source URL instead of a second one being created. */
export const LEGACY_WEBHOOK_NAME = 'Hookdeck: livekit-call-log';

export interface Session {
  token: string;
  api_url: string;
}

export interface CloudProject {
  id: string;
  name?: string;
  subdomain?: string;
  url?: string;
}

export interface CloudWebhook {
  id: string;
  name?: string;
  url?: string;
  signingKey?: string;
}

export const CLI_CONFIG_PATH = path.join(os.homedir(), '.livekit', 'cli-config.yaml');

/** The token to call the management API with: LIVEKIT_SESSION_TOKEN, else the default `lk` user's unexpired session. */
export function resolveSession(env: NodeJS.ProcessEnv, config_text: string | undefined, now_s = Math.floor(Date.now() / 1000)): Session | undefined {
  if (env.LIVEKIT_SESSION_TOKEN) return { token: env.LIVEKIT_SESSION_TOKEN, api_url: DEFAULT_API_URL };
  if (!config_text) return undefined;
  let config: any;
  try { config = parse(config_text); } catch { return undefined; }
  const users: any[] = Array.isArray(config?.users) ? config.users : [];
  const user = users.find((u) => u.id === config.default_user || u.email === config.default_user) ?? (users.length === 1 ? users[0] : undefined);
  if (!user?.session_token) return undefined;
  // Skip an expired session (a zero expiry is treated as unknown, so it is kept)
  if (user.session_expiry && user.session_expiry <= now_s) return undefined;
  return { token: user.session_token, api_url: (user.api_url || DEFAULT_API_URL).replace(/\/+$/, '') };
}

export function readCliConfig(): string | undefined {
  try { return fs.readFileSync(CLI_CONFIG_PATH, 'utf-8'); } catch { return undefined; }
}

/** The project whose URL or subdomain matches LIVEKIT_URL's host; LIVEKIT_PROJECT_ID overrides. */
export function resolveProjectId(env: NodeJS.ProcessEnv, projects: CloudProject[]): string | undefined {
  if (env.LIVEKIT_PROJECT_ID) return env.LIVEKIT_PROJECT_ID;
  let host: string;
  try { host = new URL((env.LIVEKIT_URL || '').replace(/^ws/, 'http')).host.toLowerCase(); } catch { return undefined; }
  const hostOf = (value?: string) => {
    if (!value) return '';
    try { return new URL(value.includes('://') ? value.replace(/^ws/, 'http') : `https://${value}`).host.toLowerCase(); } catch { return ''; }
  };
  const match = projects.find((p) => hostOf(p.url) === host)
    ?? projects.find((p) => p.subdomain && host === `${p.subdomain}.livekit.cloud`.toLowerCase());
  return match?.id;
}

/** The webhook that already points at our Hookdeck source, or one this demo created under its old name, if any. */
export function findWebhook(webhooks: CloudWebhook[], url: string): CloudWebhook | undefined {
  return webhooks.find((w) => w.url === url) ?? webhooks.find((w) => w.name === LEGACY_WEBHOOK_NAME);
}

async function call<T>(session: Session, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${session.api_url}/v0${route}`, {
    method,
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LiveKit Cloud ${method} /v0${route} -> ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const asList = <T>(value: any, key: string): T[] => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.[key]) ? value[key] : []);

/** Creates or updates the webhook. Returns what happened; throws on an API failure (the caller falls back to the dashboard steps). */
export async function ensureWebhook(session: Session, env: NodeJS.ProcessEnv, url: string, signing_key: string): Promise<{ action: 'created' | 'updated' | 'unchanged'; project_id: string; webhook_id: string }> {
  const project_id = resolveProjectId(env, asList<CloudProject>(await call(session, 'GET', '/projects'), 'projects'));
  if (!project_id) throw new Error('no LiveKit Cloud project matches LIVEKIT_URL (set LIVEKIT_PROJECT_ID)');
  const base = `/projects/${project_id}/webhooks`;
  const existing = findWebhook(asList<CloudWebhook>(await call(session, 'GET', base), 'webhooks'), url);
  if (!existing) {
    const created = await call<any>(session, 'POST', base, { name: WEBHOOK_NAME, url, signingKey: signing_key });
    return { action: 'created', project_id, webhook_id: created?.id ?? created?.webhook?.id ?? '' };
  }
  if (existing.name === WEBHOOK_NAME && existing.url === url && existing.signingKey === signing_key) return { action: 'unchanged', project_id, webhook_id: existing.id };
  await call(session, 'PATCH', `${base}/${existing.id}`, { name: WEBHOOK_NAME, url, signingKey: signing_key });
  return { action: 'updated', project_id, webhook_id: existing.id };
}
