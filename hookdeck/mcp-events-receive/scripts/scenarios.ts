import { loadEnv, requireEnv } from '../src/shared/env.js';
import { HookdeckApi } from '../src/agent/hookdeck.js';

/*
 * Runs the demo's scenarios against a running sender and agent, and prints pass
 * or fail with evidence. Works locally (agent in CLI mode) and deployed (agent
 * in HTTP mode): point SENDER_MCP_URL and AGENT_URL at the services.
 *
 *   npm run scenarios
 *
 * Each scenario opens an incident on the sender, then checks what the agent
 * handled and what Event Gateway recorded for the request. With the agent in
 * CLI mode, two more take `hookdeck listen` down (stopped cleanly, then killed)
 * and check how the event gets through once it's back.
 */

loadEnv();

const senderBase = (process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp').replace(/\/mcp$/, '');
const agentBase = (process.env.AGENT_URL || process.env.AGENT_PUBLIC_URL || `http://localhost:${process.env.AGENT_PORT || 3200}`).replace(/\/$/, '');
const senderAuth = { Authorization: `Bearer ${process.env.SENDER_TOKEN || 'demo-sender-token'}`, 'Content-Type': 'application/json' };
const agentAuth = { Authorization: `Bearer ${process.env.AGENT_TOKEN || 'demo-agent-token'}`, 'Content-Type': 'application/json' };
const api = new HookdeckApi(requireEnv('HOOKDECK_API_KEY'), process.env.HOOKDECK_API_BASE || undefined);
// Deliveries usually take about a second, but one CLI run saw a platform-side hold of up to
// about 100 s before the first attempt (see docs/PLAN.md), so allow time.
const deliveryTimeoutMs = Number(process.env.SCENARIO_TIMEOUT_MS || 120_000);

interface Handled {
  eventId: string;
  attempt: string | null;
  data: Record<string, unknown>;
}
interface AgentStatus {
  delivery: 'cli' | 'http';
  listening: boolean | null;
  recovery: { passes: number; requestsRetried: string[]; eventsRetried: string[] };
  subscription?: { id: string; callbackUrl: string; sourceId: string; connectionId: string; refreshBefore: string | null };
  failing: boolean;
  counts: Record<string, number>;
  handled: Handled[];
}
interface Emitted {
  eventId: string;
  deliveries: Array<{ subscriptionId: string; attempts: Array<{ status: number | null }> }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const agentStatus = async (): Promise<AgentStatus> => (await fetch(`${agentBase}/demo/status`, { headers: agentAuth })).json() as Promise<AgentStatus>;
const setFailing = (failing: boolean) => fetch(`${agentBase}/demo/fail`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ failing }) });
const setListen = (action: 'stop' | 'kill' | 'start') =>
  fetch(`${agentBase}/demo/listen`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ action }) });
const emit = async (input: Record<string, unknown>): Promise<Emitted> =>
  (await fetch(`${senderBase}/demo/incidents`, { method: 'POST', headers: senderAuth, body: JSON.stringify(input) })).json() as Promise<Emitted>;
const senderStatuses = (emitted: Emitted) => emitted.deliveries.flatMap((d) => d.attempts.map((a) => a.status));

async function waitForHandled(eventId: string, timeoutMs = deliveryTimeoutMs): Promise<Handled | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const found = (await agentStatus()).handled.find((h) => h.eventId === eventId);
    if (found) return found;
    await sleep(1000);
  }
  return undefined;
}

/** Event Gateway's requests for this source that carry the given webhook-id. */
async function requestsFor(sourceId: string, webhookId: string) {
  const page = await api.request<{ models: Array<{ id: string; rejection_cause: string | null; events_count: number; ignored_count: number }> }>(
    'GET',
    `/requests?source_id=${sourceId}&limit=50`,
  );
  const matches = [];
  for (const request of page.models) {
    const detail = await api.request<{ data?: { headers?: Record<string, string> } }>('GET', `/requests/${request.id}`);
    if (detail.data?.headers?.['webhook-id'] === webhookId) matches.push(request);
  }
  return matches;
}

/** The request list is eventually consistent, so poll until the expected number of requests appears. */
async function waitForRequests(sourceId: string, webhookId: string, count: number, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let found: Awaited<ReturnType<typeof requestsFor>> = [];
  while (Date.now() < end) {
    found = await requestsFor(sourceId, webhookId);
    if (found.length >= count) return found;
    await sleep(3000);
  }
  return found;
}

/** Waits for Event Gateway to record a request's ignored event for this connection, and returns its cause. */
async function waitForIgnoredCause(requestId: string, connectionId: string, timeoutMs = 30_000): Promise<string | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ignored = await api.request<{ models: Array<{ webhook_id: string; cause: string }> }>('GET', `/requests/${requestId}/ignored_events`);
    const cause = ignored.models.find((e) => e.webhook_id === connectionId)?.cause;
    if (cause) return cause;
    await sleep(2000);
  }
  return undefined;
}

type Result = { name: string; pass: boolean; evidence: string };
const results: Result[] = [];
const record = (name: string, pass: boolean, evidence: string) => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${evidence}`);
};

const status = await agentStatus();
const subscription = status.subscription;
if (!subscription) {
  console.error('The agent has no live subscription. Start the sender and the agent first (see README).');
  process.exit(1);
}
const sourceId = subscription.sourceId;
const connectionId = subscription.connectionId;
console.log(`Agent subscription ${subscription.id}, callback ${subscription.callbackUrl}\n`);
if (status.failing) await setFailing(false);

// 1. The subscription is live on the sender, so Event Gateway answered its challenge.
{
  const list = (await (await fetch(`${senderBase}/demo/subscriptions`, { headers: senderAuth })).json()) as Array<{ id: string; url: string; expiresAt: string }>;
  const live = list.find((s) => s.id === subscription.id);
  record(
    'subscribed: challenge answered by Event Gateway',
    Boolean(live && Date.parse(live.expiresAt) > Date.now() && live.url === subscription.callbackUrl),
    live ? `sender holds ${live.id} for ${live.url} until ${live.expiresAt}` : 'sender has no such subscription',
  );
}

// 2. A normal event reaches the agent.
{
  const emitted = await emit({ severity: 'P1', title: 'Scenario: normal delivery' });
  const handled = await waitForHandled(emitted.eventId);
  record('deliver', Boolean(handled), `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, agent ${handled ? `handled on attempt ${handled.attempt}` : 'never handled it'}`);
}

// 3. The same webhook-id sent twice (re-signed) is delivered once.
{
  const emitted = await emit({ title: 'Scenario: duplicate', duplicate: true });
  const handled = await waitForHandled(emitted.eventId);
  await sleep(10_000);
  const times = (await agentStatus()).handled.filter((h) => h.eventId === emitted.eventId).length;
  const requests = await waitForRequests(sourceId, emitted.eventId, 2);
  const ignored = requests.filter((r) => r.ignored_count > 0).length;
  record(
    'duplicate: second request ignored by the dedup rule',
    Boolean(handled) && times === 1 && requests.length === 2 && ignored === 1,
    `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, agent handled it ${times} time(s), Event Gateway has ${requests.length} request(s), ${ignored} ignored`,
  );
}

// 4. A badly signed delivery is rejected by Event Gateway and never reaches the agent.
{
  const emitted = await emit({ title: 'Scenario: bad signature', badSignature: true });
  const requests = await waitForRequests(sourceId, emitted.eventId, 1);
  await sleep(5000);
  const reached = (await agentStatus()).handled.some((h) => h.eventId === emitted.eventId);
  const cause = requests[0]?.rejection_cause ?? null;
  record(
    'bad signature: rejected, never delivered',
    cause === 'VERIFICATION_FAILED' && !reached,
    `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, request ${requests[0]?.id ?? '(none)'} ${cause ?? 'not rejected'}, agent ${reached ? 'received it' : 'never received it'}`,
  );
}

// 5. While the agent answers 503, Event Gateway holds the event and retries; the sender sees one 200.
{
  await setFailing(true);
  const before = (await agentStatus()).counts.failedOnPurpose ?? 0;
  const emitted = await emit({ title: 'Scenario: agent down, then back' });
  const end = Date.now() + deliveryTimeoutMs;
  while (Date.now() < end && ((await agentStatus()).counts.failedOnPurpose ?? 0) === before) await sleep(1000);
  const failures = ((await agentStatus()).counts.failedOnPurpose ?? 0) - before;
  await setFailing(false);
  const handled = await waitForHandled(emitted.eventId);
  record(
    'agent down, then back: held and retried',
    failures > 0 && Boolean(handled) && Number(handled?.attempt) > 1 && senderStatuses(emitted).length === 1,
    `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, agent answered 503 ${failures} time(s), then handled it on attempt ${handled?.attempt ?? '(never)'}`,
  );
}

// 6. CLI only: `listen` stopped cleanly. No event is created, the request is stored as
// CLI_DISCONNECTED, and the agent's recovery retries it when `listen` is back.
if (status.delivery === 'cli') {
  try {
    await setListen('stop');
    const emitted = await emit({ title: 'Scenario: listen stopped cleanly' });
    const [request] = await waitForRequests(sourceId, emitted.eventId, 1);
    const cause = request ? await waitForIgnoredCause(request.id, connectionId) : undefined;
    await setListen('start');
    const handled = await waitForHandled(emitted.eventId);
    const recovered = request ? (await agentStatus()).recovery.requestsRetried.includes(request.id) : false;
    record(
      'listen stopped cleanly: stored, then recovered by request retry',
      cause === 'CLI_DISCONNECTED' && Boolean(handled) && recovered,
      `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, request ${request?.id ?? '(none)'} ignored as ${cause ?? '(nothing)'}, ` +
        `${recovered ? 'retried by the agent on reconnect' : 'not retried by the agent'}, agent ${handled ? 'handled it' : 'never handled it'}`,
    );
  } finally {
    await setListen('start');
  }
}

// 7. CLI only: `listen` killed. Event Gateway keeps the session for about 2 minutes, so an
// event is created; its attempts fail with CLI_UNAVAILABLE until `listen` is back, and the
// retry rule delivers it. Recovery must leave it alone (a manual retry would deliver twice).
if (status.delivery === 'cli') {
  try {
    await setListen('kill');
    await sleep(3000);
    const emitted = await emit({ title: 'Scenario: listen killed' });
    await sleep(Number(process.env.SCENARIO_KILL_DOWNTIME_MS || 30_000));
    await setListen('start');
    const handled = await waitForHandled(emitted.eventId);
    await sleep(5000);
    const after = await agentStatus();
    const times = after.handled.filter((h) => h.eventId === emitted.eventId).length;
    const [request] = await waitForRequests(sourceId, emitted.eventId, 1);
    const recoveredByHand = request ? after.recovery.requestsRetried.includes(request.id) : false;
    record(
      'listen killed: held by the retry rule, delivered once when back',
      Boolean(handled) && Number(handled?.attempt) > 1 && times === 1 && !recoveredByHand,
      `${emitted.eventId}: sender saw ${JSON.stringify(senderStatuses(emitted))}, agent handled it ${times} time(s), on attempt ${handled?.attempt ?? '(never)'}, ` +
        `${recoveredByHand ? 'after a request retry' : 'with no manual retry'}`,
    );
  } finally {
    await setListen('start');
  }
}

// 8. Deployed only: a request that didn't come through Event Gateway is refused.
if (agentBase.startsWith('https://')) {
  const response = await fetch(`${agentBase}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mcp-subscription-id': subscription.id },
    body: JSON.stringify({ eventId: 'evt_forged', name: 'incident.created', timestamp: new Date().toISOString(), data: {}, cursor: null }),
  });
  record('forged request to the agent: refused', response.status === 401, `POST ${agentBase}/events without x-hookdeck-signature got ${response.status}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} scenarios passed.`);
process.exit(failed.length ? 1 : 0);
