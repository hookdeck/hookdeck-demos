import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, numberEnv, requireEnv } from '../shared/env.js';
import { HookdeckApi } from '../agent/hookdeck.js';

/*
 * A live view of the demo: the MCP server, Event Gateway and the agent, with
 * each event moving between them. It reads three places and merges them into
 * one state that the page polls:
 *
 * - the errors the sender reported, and the status of every delivery attempt it made;
 * - Event Gateway's requests and events for the agent's source and connection;
 * - the agent's status: its subscription, `hookdeck listen`, and what it handled.
 *
 * The page's buttons call the same demo endpoints the scripts use. The API key
 * and the demo tokens stay here; the browser only sees the merged state.
 *
 *   npm run viz        # then open http://localhost:3300
 */

loadEnv();

const port = numberEnv('VIZ_PORT', 3300);
const senderMcpUrl = process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp';
const senderBase = senderMcpUrl.replace(/\/mcp$/, '');
const agentBase = (process.env.AGENT_URL || `http://localhost:${process.env.AGENT_PORT || 3200}`).replace(/\/$/, '');
const senderAuth = { Authorization: `Bearer ${process.env.SENDER_TOKEN || 'demo-sender-token'}`, 'Content-Type': 'application/json' };
const agentAuth = { Authorization: `Bearer ${process.env.AGENT_TOKEN || 'demo-agent-token'}`, 'Content-Type': 'application/json' };
const api = new HookdeckApi(requireEnv('HOOKDECK_API_KEY'), process.env.HOOKDECK_API_BASE || undefined);
const publicDir = fileURLToPath(new URL('../../viz/', import.meta.url));

interface AgentStatus {
  delivery: 'cli' | 'http';
  destinationAuth: 'HOOKDECK_SIGNATURE' | 'STANDARD_WEBHOOKS' | 'BEARER_TOKEN';
  listening: boolean | null;
  failing: boolean;
  subscription?: { id: string; refreshBefore: string | null; callbackUrl: string; sourceId: string; connectionId: string };
  counts: Record<string, number>;
  recovery: { passes: number; requestsRetried: string[]; eventsRetried: string[] };
  handled: Array<{ eventId: string; attempt: string | null; receivedAt: string; next?: string }>;
}
interface SenderSubscription {
  id: string;
  url: string;
  expiresAt: string;
  subscribedAt?: string;
  verifiedAt?: string;
  refreshedAt?: string;
}
interface SenderError {
  eventId: string;
  error: { title: string; culprit: string; level: string };
  duplicate: boolean;
  badSignature: boolean;
  sentAt: string;
  deliveries: Array<{ subscriptionId: string; attempts: Array<{ attempt: number; at: string; status: number | null; error: string | null }> }>;
}
interface RequestSummary {
  id: string;
  created_at: string;
  rejection_cause: string | null;
  events_count: number;
  cli_events_count?: number;
  ignored_count: number;
}
interface EventSummary {
  id: string;
  request_id: string;
  status: string;
  attempts: number;
  response_status: number | null;
  error_code: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
}

const getJson = async <T>(url: string, headers: Record<string, string>): Promise<T | null> => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
};

// A request's headers and its ignored events don't change once known, so each is fetched once.
const webhookIdOf = new Map<string, string | null>();
const ignoredCausesOf = new Map<string, string[]>();

async function gatewayView(sourceId: string, connectionId: string) {
  const [requests, events] = await Promise.all([
    api.request<{ models: RequestSummary[] }>('GET', `/requests?source_id=${sourceId}&limit=30`),
    api.request<{ models: EventSummary[] }>('GET', `/events?webhook_id=${connectionId}&limit=30`),
  ]);
  await Promise.all(
    requests.models.map(async (request) => {
      if (!webhookIdOf.has(request.id)) {
        const detail = await api.request<{ data?: { headers?: Record<string, string> } }>('GET', `/requests/${request.id}`);
        webhookIdOf.set(request.id, detail.data?.headers?.['webhook-id'] ?? null);
      }
      if (request.ignored_count > 0 && !ignoredCausesOf.has(request.id)) {
        const ignored = await api.request<{ models: Array<{ webhook_id: string; cause: string }> }>('GET', `/requests/${request.id}/ignored_events`);
        const causes = ignored.models.filter((e) => e.webhook_id === connectionId).map((e) => e.cause);
        if (causes.length) ignoredCausesOf.set(request.id, causes);
      }
    }),
  );
  return { requests: requests.models, events: events.models };
}

/** One entry per event the sender opened, with what each of the three parts did with it. */
async function buildState() {
  const [agent, subscriptions, errors] = await Promise.all([
    getJson<AgentStatus>(`${agentBase}/demo/status`, agentAuth),
    getJson<SenderSubscription[]>(`${senderBase}/demo/subscriptions`, senderAuth),
    getJson<SenderError[]>(`${senderBase}/demo/errors`, senderAuth),
  ]);
  let gateway: Awaited<ReturnType<typeof gatewayView>> | null = null;
  let gatewayError: string | null = null;
  if (agent?.subscription) {
    try {
      gateway = await gatewayView(agent.subscription.sourceId, agent.subscription.connectionId);
    } catch (error) {
      gatewayError = (error as Error).message;
    }
  }

  const subscriptionId = agent?.subscription?.id;
  const packets = (errors ?? [])
    .filter((i) => !subscriptionId || i.deliveries.some((d) => d.subscriptionId === subscriptionId))
    .slice(-12)
    .map((i) => {
      const requests = (gateway?.requests ?? []).filter((r) => webhookIdOf.get(r.id) === i.eventId);
      const requestIds = new Set(requests.map((r) => r.id));
      const event = (gateway?.events ?? []).filter((e) => requestIds.has(e.request_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
      const causes = requests.flatMap((r) => ignoredCausesOf.get(r.id) ?? []);
      const handled = agent?.handled.find((h) => h.eventId === i.eventId);
      const retriedByAgent = requests.some((r) => agent?.recovery.requestsRetried.includes(r.id));
      const attempts = i.deliveries.find((d) => d.subscriptionId === subscriptionId)?.attempts ?? i.deliveries[0]?.attempts ?? [];
      return {
        eventId: i.eventId,
        title: i.error.title,
        culprit: i.error.culprit,
        level: i.error.level,
        kind: i.badSignature ? 'bad-signature' : i.duplicate ? 'duplicate' : 'normal',
        sentAt: i.sentAt,
        sender: attempts.map((a) => ({ at: a.at, status: a.status, error: a.error })),
        gateway: {
          requests: requests.length,
          verificationFailed: requests.some((r) => r.rejection_cause === 'VERIFICATION_FAILED'),
          deduplicated: causes.filter((c) => c !== 'CLI_DISCONNECTED').length,
          // Once the agent's retry succeeds, Event Gateway drops the ignored event, and the agent only
          // retries requests ignored as CLI_DISCONNECTED, so a retry implies one.
          cliDisconnected: causes.includes('CLI_DISCONNECTED') || retriedByAgent,
          retriedByAgent,
          event: event
            ? {
                status: event.status,
                attempts: event.attempts,
                responseStatus: event.response_status,
                errorCode: event.error_code,
                nextAttemptAt: event.next_attempt_at,
                lastAttemptAt: event.last_attempt_at,
              }
            : null,
        },
        agent: handled ? { handledAt: handled.receivedAt, attempt: handled.attempt, next: handled.next ?? null } : null,
      };
    });

  const senderSubscription = subscriptions?.find((s) => s.id === subscriptionId);
  return {
    now: new Date().toISOString(),
    agent: agent && {
      delivery: agent.delivery,
      destinationAuth: agent.destinationAuth,
      listening: agent.listening,
      failing: agent.failing,
      counts: agent.counts,
      subscription: agent.subscription && {
        id: agent.subscription.id,
        refreshBefore: agent.subscription.refreshBefore,
        sourceId: agent.subscription.sourceId,
        callbackUrl: agent.subscription.callbackUrl,
      },
    },
    sender: senderSubscription ?? null,
    senderReachable: subscriptions !== null,
    gatewayError,
    packets,
  };
}

// Several tabs share one poll's worth of API calls.
let cached: { at: number; state: Promise<unknown> } | undefined;
const state = () => {
  if (!cached || Date.now() - cached.at > 900) cached = { at: Date.now(), state: buildState() };
  return cached.state;
};

const post = (url: string, headers: Record<string, string>, body: unknown) =>
  fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.text() }));

/** The page's buttons. Emits answer at once: the sender's own retries can take several seconds. */
const actions: Record<string, () => Promise<unknown>> = {
  emit: async () => void post(`${senderBase}/demo/errors`, senderAuth, {}).catch(() => {}),
  duplicate: async () => void post(`${senderBase}/demo/errors`, senderAuth, { duplicate: true }).catch(() => {}),
  'bad-signature': async () => void post(`${senderBase}/demo/errors`, senderAuth, { badSignature: true }).catch(() => {}),
  resubscribe: () => post(`${agentBase}/demo/resubscribe`, agentAuth, {}),
  'fail-on': () => post(`${agentBase}/demo/fail`, agentAuth, { failing: true }),
  'fail-off': () => post(`${agentBase}/demo/fail`, agentAuth, { failing: false }),
  'listen-stop': () => post(`${agentBase}/demo/listen`, agentAuth, { action: 'stop' }),
  'listen-kill': () => post(`${agentBase}/demo/listen`, agentAuth, { action: 'kill' }),
  'listen-start': () => post(`${agentBase}/demo/listen`, agentAuth, { action: 'start' }),
};

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  try {
    if (pathname === '/api/state' && req.method === 'GET') return json(200, await state());
    if (pathname.startsWith('/api/action/') && req.method === 'POST') {
      const action = actions[pathname.slice('/api/action/'.length)];
      if (!action) return json(404, { error: 'unknown action' });
      await action();
      cached = undefined;
      return json(200, { ok: true });
    }
    const file = normalize(join(publicDir, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(publicDir) || !types[extname(file)]) return json(404, { error: 'not found' });
    const content = await readFile(file).catch(() => null);
    if (!content) return json(404, { error: 'not found' });
    res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-cache' }).end(content);
  } catch (error) {
    if (!res.headersSent) json(500, { error: (error as Error).message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[viz] http://localhost:${port} (sender ${senderBase}, agent ${agentBase})`));
