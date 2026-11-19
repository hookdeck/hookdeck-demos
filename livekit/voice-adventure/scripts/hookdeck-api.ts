// Generated from `_shared/hookdeck/hookdeck-api.ts`; edit there and run `npm run sync-shared`.
/**
 * Hookdeck REST API helper for demo setup and probe scripts.
 *
 * Calls the API with the project API key in HOOKDECK_API_KEY (loaded from .env), so it
 * works on the project that key belongs to. Setup creates the Event Gateway source,
 * destination and connection with it; the Hookdeck CLI is only used by `npm run listen`.
 *
 * Needs Node 22+ (global fetch) and `dotenv` in the demo.
 *
 *   const connection = await hookdeck('PUT', '/connections', {
 *     name: 'my-connection',
 *     source: { name: 'my-source', type: 'WEBHOOK' },
 *     destination: { name: 'local-my-app', type: 'CLI', config: { path: '/webhooks' } },
 *   });
 *   console.log(connection.source.url);
 *
 * API reference: https://hookdeck.com/docs/api
 */
import 'dotenv/config';

export const HOOKDECK_API_BASE = 'https://api.hookdeck.com/2026-09-01';

/** The project API key from HOOKDECK_API_KEY. Exits with a hint when it isn't set. */
export function requireHookdeckApiKey(): string {
  const key = process.env.HOOKDECK_API_KEY;
  if (!key || key.startsWith('your_')) {
    console.error('❌ HOOKDECK_API_KEY is not set. Add a project API key to .env');
    console.error('   (Hookdeck dashboard: Project settings -> Secrets, https://dashboard.hookdeck.com/settings/project/secrets).');
    process.exit(1);
  }
  return key;
}

/** Calls the Hookdeck API and returns the parsed JSON response. Throws on a non-2xx status. */
export async function hookdeck<T = any>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${HOOKDECK_API_BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${requireHookdeckApiKey()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hookdeck API ${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : (undefined as T);
}
