import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadEnv, numberEnv, requireEnv } from '../shared/env.js';
import type { SubscribeResult } from '../shared/mcp-events.js';
import { EventsClient } from './client.js';
import { HookdeckApi } from './hookdeck.js';
import { findEndpoints, provisionEndpoint, releaseEndpoint, type ProxyEndpoint, type SubscriptionKey } from './proxy.js';
import { ListenSupervisor } from './listen.js';
import { Receiver } from './receiver.js';

/*
 * An agent runtime that receives MCP Events through Event Gateway acting as its
 * forward proxy. It owns the proxy: it creates an MCP Events source per
 * subscription (with the subscription's secret), subscribes with the source
 * URL as the callback, refreshes before the grant runs out, and on exit
 * unsubscribes and deletes the source.
 */

loadEnv();
const { values: flags } = parseArgs({ options: { keep: { type: 'boolean', default: false } } });

const log = (message: string) => console.log(`[agent] ${message}`);
const port = numberEnv('PORT', numberEnv('AGENT_PORT', 3200));
// `cli`: Event Gateway delivers through `hookdeck listen` to localhost (local development, no public URL).
// `http`: Event Gateway delivers to AGENT_PUBLIC_URL (a deployed agent).
const delivery = (process.env.AGENT_DELIVERY || (process.env.AGENT_PUBLIC_URL ? 'http' : 'cli')) as 'cli' | 'http';
const publicUrl = delivery === 'http' ? requireEnv('AGENT_PUBLIC_URL').replace(/\/$/, '') : undefined;
const agentToken = process.env.AGENT_TOKEN || 'demo-agent-token';
// Over the internet, the endpoint checks each request came from Event Gateway. Through `hookdeck listen`
// requests arrive on localhost from the CLI, which is already authenticated to the project.
const hookdeckSigningSecret = delivery === 'http' ? requireEnv('HOOKDECK_SIGNING_SECRET') : undefined;

const apiKey = requireEnv('HOOKDECK_API_KEY');
const api = new HookdeckApi(apiKey, process.env.HOOKDECK_API_BASE || undefined);
const listener = delivery === 'cli' ? new ListenSupervisor(port, apiKey, log) : undefined;
const senderUrl = process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp';
const client = new EventsClient(senderUrl, process.env.SENDER_TOKEN || 'demo-sender-token');
const namePrefix = process.env.AGENT_NAME || 'mcp-events-agent';
const key: SubscriptionKey = {
  serverUrl: senderUrl,
  name: process.env.AGENT_EVENT || 'incident.created',
  arguments: JSON.parse(process.env.AGENT_ARGUMENTS || '{}') as Record<string, unknown>,
};

interface Live {
  endpoint: ProxyEndpoint;
  subscription: SubscribeResult;
  refreshTimer?: NodeJS.Timeout;
}
let live: Live | undefined;

const receiver = new Receiver({
  hookdeckSigningSecret,
  secretFor: (subscriptionId) => (live && live.subscription.id === subscriptionId ? live.endpoint.secret : undefined),
  onTerminated: (subscriptionId) => log(`the server ended ${subscriptionId}; it won't be refreshed`),
  log,
});

const authorized = (req: http.IncomingMessage) => {
  const presented = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '');
  const expected = Buffer.from(agentToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
};
const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (pathname === '/events' && req.method === 'POST') return await receiver.handle(req, res);
    if (!authorized(req)) return res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
    if (pathname === '/demo/status' && req.method === 'GET') {
      return json(res, 200, {
        subscription: live && { ...live.subscription, callbackUrl: live.endpoint.url, sourceId: live.endpoint.sourceId, connectionId: live.endpoint.connectionId },
        failing: receiver.failing,
        counts: receiver.counts,
        handled: receiver.handled,
      });
    }
    if (pathname === '/demo/fail' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { failing?: boolean }) : {};
      receiver.failing = body.failing !== false;
      log(receiver.failing ? 'failing on purpose: every delivery gets 503 until turned off' : 'back to normal');
      return json(res, 200, { failing: receiver.failing });
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    log(`error on ${pathname}: ${(error as Error).message}`);
    if (!res.headersSent) json(res, 500, { error: (error as Error).message });
  }
});

function scheduleRefresh() {
  if (!live?.subscription.refreshBefore) return;
  clearTimeout(live.refreshTimer);
  const remaining = Date.parse(live.subscription.refreshBefore) - Date.now();
  const margin = Math.min(Math.max(remaining * 0.2, 5_000), 5 * 60_000);
  live.refreshTimer = setTimeout(async () => {
    if (!live) return;
    try {
      live.subscription = await client.subscribe(key, live.endpoint.url, live.endpoint.secret, ttlMs);
      log(`refreshed ${live.subscription.id} until ${live.subscription.refreshBefore}; deliveryStatus ${JSON.stringify(live.subscription.deliveryStatus ?? null)}`);
      scheduleRefresh();
    } catch (error) {
      log(`refresh failed: ${(error as Error).message}`);
    }
  }, Math.max(remaining - margin, 1_000));
  live.refreshTimer.unref();
}

/** Removes endpoints an earlier run left behind, unsubscribing each from the server first. */
async function cleanUpPreviousRuns() {
  for (const stale of await findEndpoints(api, namePrefix)) {
    if (stale.key?.serverUrl === senderUrl) {
      await client.unsubscribe(stale.key, stale.url).catch((error) => log(`unsubscribe of ${stale.url} failed: ${(error as Error).message}`));
    }
    await releaseEndpoint(api, stale);
    log(`removed endpoint ${stale.sourceId} left by an earlier run`);
  }
}

const ttlMs = process.env.AGENT_TTL_MS ? Number(process.env.AGENT_TTL_MS) : undefined;

await new Promise<void>((resolve) => server.listen(port, resolve));
log(`event endpoint listening on :${port}${publicUrl ? `, public URL ${publicUrl}/events` : ', delivered through hookdeck listen'}`);

await client.connect();
await client.checkEvent(key.name);
await cleanUpPreviousRuns();

const endpoint = await provisionEndpoint(api, key, {
  namePrefix,
  deliverTo: publicUrl ? { type: 'http', url: `${publicUrl}/events` } : { type: 'cli', path: '/events' },
  retry: { strategy: 'linear', intervalMs: numberEnv('AGENT_RETRY_INTERVAL_MS', 15_000), count: numberEnv('AGENT_RETRY_COUNT', 10) },
  dedupWindowMs: numberEnv('AGENT_DEDUP_WINDOW_MS', 60 * 60_000),
});
log(`created MCP Events source ${endpoint.sourceId} (${endpoint.url}) and connection ${endpoint.connectionId}`);
// Connections must exist before `listen` starts, or it creates its own (cli-<source>).
await listener?.listenTo([endpoint.sourceName]);

try {
  const subscription = await client.subscribe(key, endpoint.url, endpoint.secret, ttlMs);
  live = { endpoint, subscription };
  log(`subscribed to ${key.name} ${JSON.stringify(key.arguments)} as ${subscription.id}, refresh before ${subscription.refreshBefore}`);
  scheduleRefresh();
} catch (error) {
  const { code, data } = error as { code?: number; data?: unknown };
  log(`subscribe failed: ${(error as Error).message}${code ? ` (code ${code}, data ${JSON.stringify(data)})` : ''}`);
  await listener?.stop();
  await releaseEndpoint(api, endpoint);
  process.exit(1);
}

// Ctrl+C can deliver SIGINT more than once (the terminal's process group, plus npm and tsx relaying it),
// so shutdown runs once and later signals wait for it.
let shuttingDown: Promise<void> | undefined;
const shutdown = () => {
  shuttingDown ??= (async () => {
    if (live && !flags.keep) {
      clearTimeout(live.refreshTimer);
      log(`unsubscribing ${live.subscription.id}`);
      await client.unsubscribe(key, live.endpoint.url).catch((error) => log(`unsubscribe failed: ${(error as Error).message}`));
      await listener?.stop();
      await releaseEndpoint(api, live.endpoint).catch((error) => log(`cleanup failed: ${(error as Error).message}`));
      log(`deleted source ${live.endpoint.sourceId} and connection ${live.endpoint.connectionId}`);
    }
    await listener?.stop();
    await client.close().catch(() => {});
    server.closeAllConnections();
    server.close(() => process.exit(0));
  })();
  return shuttingDown;
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
