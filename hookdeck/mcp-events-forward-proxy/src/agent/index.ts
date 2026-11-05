import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadEnv, numberEnv, requireEnv } from '../shared/env.js';
import type { SubscribeResult } from '../shared/mcp-events.js';
import { EventsClient } from './client.js';
import { HookdeckApi } from './hookdeck.js';
import {
  endpointMatches,
  findEndpoints,
  provisionEndpoint,
  releaseEndpoint,
  resumeEndpoint,
  type DeliverTo,
  type DestinationAuth,
  type ProxyEndpoint,
  type SubscriptionKey,
} from './proxy.js';
import { ListenSupervisor } from './listen.js';
import { Receiver } from './receiver.js';
import { startRecovery } from './recover.js';

/*
 * An agent runtime that receives MCP Events through Event Gateway acting as its
 * forward proxy. It owns the proxy: it creates an MCP Events source per
 * subscription (with the subscription's secret), subscribes with the source
 * URL as the callback, refreshes before the grant runs out, and on exit
 * unsubscribes and deletes the source.
 *
 * With --keep it leaves the subscription and source in place on exit. The MCP
 * server keeps delivering, Event Gateway keeps storing, and the next start picks
 * the endpoint back up and recovers what `hookdeck listen` missed.
 */

loadEnv();
const { values: flags } = parseArgs({ options: { keep: { type: 'boolean', default: false } } });

const log = (message: string) => console.log(`[agent] ${message}`);
const port = numberEnv('PORT', numberEnv('AGENT_PORT', 3200));
// `cli`: Event Gateway delivers through `hookdeck listen`, which needs no public URL (the default; run locally here).
// `http`: Event Gateway delivers to AGENT_PUBLIC_URL (a deployed agent).
const delivery = (process.env.AGENT_DELIVERY || (process.env.AGENT_PUBLIC_URL ? 'http' : 'cli')) as 'cli' | 'http';
const publicUrl = delivery === 'http' ? requireEnv('AGENT_PUBLIC_URL').replace(/\/$/, '') : undefined;
const agentToken = process.env.AGENT_TOKEN || 'demo-agent-token';
// How Event Gateway authenticates to the agent. SEP-3415: the proxy terminates HMAC and
// re-authenticates to the destination with whatever mechanism the destination requires.
// - `hookdeck-signature` (the default): x-hookdeck-signature, checked with HOOKDECK_SIGNING_SECRET.
// - `standard-webhooks`: re-signed with the subscription's secret, for an agent that already verifies it.
// - `bearer`: Authorization: Bearer AGENT_BEARER_TOKEN, as an API gateway in front of the agent requires.
const authMode = process.env.AGENT_DESTINATION_AUTH || 'hookdeck-signature';
const destinationAuth: DestinationAuth =
  authMode === 'bearer'
    ? { type: 'BEARER_TOKEN', token: requireEnv('AGENT_BEARER_TOKEN') }
    : authMode === 'standard-webhooks'
      ? { type: 'STANDARD_WEBHOOKS' }
      : { type: 'HOOKDECK_SIGNATURE' };
const hookdeckSigningSecret = destinationAuth.type === 'HOOKDECK_SIGNATURE' ? requireEnv('HOOKDECK_SIGNING_SECRET') : undefined;

const apiKey = requireEnv('HOOKDECK_API_KEY');
const api = new HookdeckApi(apiKey, process.env.HOOKDECK_API_BASE || undefined);
const listener = delivery === 'cli' ? new ListenSupervisor(port, apiKey, log) : undefined;
const senderUrl = process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp';
const client = new EventsClient(senderUrl, process.env.SENDER_TOKEN || 'demo-sender-token');
const namePrefix = process.env.AGENT_NAME || 'mcp-events-agent';
const key: SubscriptionKey = {
  serverUrl: senderUrl,
  name: process.env.AGENT_EVENT || 'error.detected',
  // By default: new errors at `error` level or worse, in production.
  arguments: JSON.parse(process.env.AGENT_ARGUMENTS || (process.env.AGENT_EVENT ? '{}' : '{"minLevel":"error","environment":"production"}')) as Record<string, unknown>,
};

interface Live {
  endpoint: ProxyEndpoint;
  subscription: SubscribeResult;
  refreshTimer?: NodeJS.Timeout;
}
let live: Live | undefined;
/** Set once the agent has started; see `resubscribe` below. */
let resubscribeHandler: (() => Promise<void>) | undefined;

const recovered = { passes: 0, requestsRetried: [] as string[], eventsRetried: [] as string[] };
let recovery: ReturnType<typeof startRecovery> | undefined;
function recover() {
  if (!live) return;
  recovery?.stop();
  recovery = startRecovery(api, live.endpoint, log, {
    intervalMs: numberEnv('AGENT_RECOVERY_INTERVAL_MS', 60_000),
    onPass: (pass) => {
      recovered.passes++;
      recovered.requestsRetried.push(...pass.requestsRetried);
      recovered.eventsRetried.push(...pass.eventsRetried);
    },
  });
}

const receiver = new Receiver({
  auth: destinationAuth.type === 'HOOKDECK_SIGNATURE' ? { type: 'HOOKDECK_SIGNATURE', signingSecret: hookdeckSigningSecret! } : destinationAuth,
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
        delivery,
        destinationAuth: destinationAuth.type,
        listening: listener?.running ?? null,
        subscription: live && { ...live.subscription, callbackUrl: live.endpoint.url, sourceId: live.endpoint.sourceId, connectionId: live.endpoint.connectionId },
        failing: receiver.failing,
        counts: receiver.counts,
        recovery: recovered,
        handled: receiver.handled,
      });
    }
    if (pathname === '/demo/listen' && req.method === 'POST' && listener) {
      // Takes `hookdeck listen` down or brings it back, to show what Event Gateway does meanwhile.
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const { action } = (chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) as { action?: string };
      if (action === 'stop') {
        log('stopping hookdeck listen cleanly (SIGINT)');
        await listener.stop();
      } else if (action === 'kill') {
        log('killing hookdeck listen (SIGKILL): Event Gateway keeps its session for about 2 minutes');
        await listener.kill();
      } else if (action === 'start') {
        await listener.listenTo();
        recover();
      } else {
        return json(res, 400, { error: 'action must be stop, kill or start' });
      }
      return json(res, 200, { listening: listener.running });
    }
    if (pathname === '/demo/resubscribe' && req.method === 'POST') {
      if (!resubscribeHandler) return json(res, 409, { error: 'still starting' });
      await resubscribeHandler();
      return json(res, 200, { subscription: live?.subscription.id });
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

/**
 * Looks for endpoints an earlier run left behind. One made for this
 * subscription and delivery type is picked up again; the rest are removed,
 * after unsubscribing each from the server.
 */
async function previousRuns(deliverTo: DeliverTo): Promise<ProxyEndpoint | undefined> {
  let resumed: ProxyEndpoint | undefined;
  for (const stale of await findEndpoints(api, namePrefix)) {
    if (!resumed && endpointMatches(stale, key, deliverTo, destinationAuth)) {
      resumed = await resumeEndpoint(api, stale);
      if (resumed) continue;
    }
    if (stale.key?.serverUrl === senderUrl) {
      await client.unsubscribe(stale.key, stale.url).catch((error) => log(`unsubscribe of ${stale.url} failed: ${(error as Error).message}`));
    }
    await releaseEndpoint(api, stale);
    log(`removed endpoint ${stale.sourceId} left by an earlier run`);
  }
  return resumed;
}

const ttlMs = process.env.AGENT_TTL_MS ? Number(process.env.AGENT_TTL_MS) : undefined;

await new Promise<void>((resolve) => server.listen(port, resolve));
log(
  `event endpoint listening on :${port}${publicUrl ? `, public URL ${publicUrl}/events` : ', delivered through hookdeck listen'}; ` +
    `Event Gateway authenticates with ${{ HOOKDECK_SIGNATURE: 'x-hookdeck-signature', STANDARD_WEBHOOKS: 'Standard Webhooks signatures', BEARER_TOKEN: 'a bearer token' }[destinationAuth.type]}`,
);

await client.connect();
await client.checkEvent(key.name);
const deliverTo: DeliverTo = publicUrl ? { type: 'http', url: `${publicUrl}/events` } : { type: 'cli', path: '/events' };
const proxyOptions = {
  namePrefix,
  deliverTo,
  destinationAuth,
  retry: { strategy: 'linear' as const, intervalMs: numberEnv('AGENT_RETRY_INTERVAL_MS', 15_000), count: numberEnv('AGENT_RETRY_COUNT', 10) },
  dedupWindowMs: numberEnv('AGENT_DEDUP_WINDOW_MS', 60 * 60_000),
};
const resumed = await previousRuns(deliverTo);
const endpoint = resumed ?? (await provisionEndpoint(api, key, proxyOptions));
log(
  `${resumed ? 'picked up the MCP Events source left by the last run:' : 'created MCP Events source'} ${endpoint.sourceId} (${endpoint.url}) and connection ${endpoint.connectionId}`,
);
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
// Only now: before `listen` is connected a request retry does nothing, and the
// subscription has to exist for the endpoint to accept what's recovered.
if (resumed) recover();

/**
 * For the demo: unsubscribe, delete the source and connection, and set up a new
 * subscription from scratch, so the whole subscribe flow can be watched again.
 */
async function resubscribe() {
  if (!live) throw new Error('no live subscription');
  const old = live;
  live = undefined;
  clearTimeout(old.refreshTimer);
  recovery?.stop();
  log(`resubscribing: unsubscribing ${old.subscription.id} and deleting source ${old.endpoint.sourceId}`);
  await client.unsubscribe(key, old.endpoint.url).catch((error) => log(`unsubscribe failed: ${(error as Error).message}`));
  await releaseEndpoint(api, old.endpoint);
  const fresh = await provisionEndpoint(api, key, proxyOptions);
  log(`created MCP Events source ${fresh.sourceId} (${fresh.url}) and connection ${fresh.connectionId}`);
  await listener?.listenTo([fresh.sourceName]);
  const subscription = await client.subscribe(key, fresh.url, fresh.secret, ttlMs);
  live = { endpoint: fresh, subscription };
  log(`subscribed to ${key.name} ${JSON.stringify(key.arguments)} as ${subscription.id}, refresh before ${subscription.refreshBefore}`);
  scheduleRefresh();
}
resubscribeHandler = resubscribe;

// Ctrl+C can deliver SIGINT more than once (the terminal's process group, plus npm and tsx relaying it),
// so shutdown runs once and later signals wait for it.
let shuttingDown: Promise<void> | undefined;
const shutdown = () => {
  shuttingDown ??= (async () => {
    recovery?.stop();
    if (live && flags.keep) {
      clearTimeout(live.refreshTimer);
      log(`keeping ${live.subscription.id} and source ${live.endpoint.sourceId}; the next start picks them up`);
    } else if (live) {
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
