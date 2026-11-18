import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { CLIENTS, Client, clientBySlug, suggestedLine } from './clients';
import { findCustomer } from './crm';
import { assertControlUrl, sendToCall } from './live-call-control';
import { createFlowState, AppFlowEntry } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';

export interface LogEntry {
  at: string;
  type: string;
  call_id?: string;
  detail: string;
  /** Size in bytes of the request body Hookdeck delivered */
  bytes: number;
}

const MAX_LOG = 100;
const LOOKUP_DELAY_MS = () => Number(process.env.LOOKUP_DELAY_MS || 6000);
const CONTROL_MODE = () => (process.env.CONTROL_MODE === 'say' ? 'say' : 'add-message');

export const logs: { [slug: string]: LogEntry[] } = Object.fromEntries(CLIENTS.map((c) => [c.slug, [] as LogEntry[]]));

// Tool calls already started, so a redelivery does not look the customer up twice. In memory, capped and
// expired: it is lost on restart and does not span instances, so production needs a durable key (for example
// the tool call ID in Redis or a database unique constraint) checked before the work starts.
const SEEN_MAX = 1000;
const SEEN_TTL_MS = 60 * 60 * 1000;
const seen_tool_calls = new Map<string, number>();
function hasSeen(id: string): boolean {
  const at = seen_tool_calls.get(id);
  if (at === undefined) return false;
  if (Date.now() - at > SEEN_TTL_MS) { seen_tool_calls.delete(id); return false; }
  return true;
}
function markSeen(id: string): void {
  seen_tool_calls.set(id, Date.now());
  // Maps iterate in insertion order, so the oldest entries go first
  for (const old of seen_tool_calls.keys()) {
    if (seen_tool_calls.size <= SEEN_MAX) break;
    seen_tool_calls.delete(old);
  }
}

/** A request the app cannot process: answered with 400 and logged, never thrown past Express. */
class BadRequestError extends Error {}

// What this app did, for the topology pane's detail strip: one `result` per delivery it answered, and one
// `outbound` per call it made back to Vapi. The flow state joins them to Event Gateway's events by ID.
const MAX_FLOW = 300;
export const flow_entries: AppFlowEntry[] = [];
function recordFlow(entry: Omit<AppFlowEntry, 'id' | 'at'>): void {
  flow_entries.push({ id: `${Date.now()}-${flow_entries.length}`, at: new Date().toISOString(), ...entry });
  if (flow_entries.length > MAX_FLOW) flow_entries.splice(0, flow_entries.length - MAX_FLOW);
}

// The app's own record of each delivery it answered, for the topology pane: it is available about a
// second after the answer, where Hookdeck's API lists a request after about 3 s and its event after up to 10 s.
export interface DeliveryRecord {
  id: string;
  received_at: string;
  /** Client slug: which source and endpoint the delivery came through. */
  client: string;
  /** The message, as the pane labels it: `tool-calls`, `status-update \u00b7 ended`, `end-of-call-report`. */
  type: string;
  call_id?: string;
  bytes: number;
  status_code: number;
  hookdeck_event_id?: string;
}
const MAX_DELIVERIES = 200;
export const deliveries: DeliveryRecord[] = [];
let delivery_count = 0;

/** How the pane names a Vapi server message. Shared with the flow state's labels. */
export function describeMessage(message: any): string {
  if (!message?.type) return 'not a Vapi message';
  const tool = message.toolCallList?.[0]?.function?.name ?? message.toolCalls?.[0]?.function?.name;
  const extra = message.type === 'tool-calls' ? tool : message.type === 'status-update' ? message.status : undefined;
  return extra ? `${message.type} \u00b7 ${extra}` : message.type;
}

// Failure injection, per client: the next N deliveries get a 503 (and/or every answer is slow), so the
// topology pane can show Hookdeck retrying. Vapi is never affected: Event Gateway has already answered it.
// tool-calls deliveries are spared unless include_tool_calls is on, because a failed one delays the CRM
// lookup and the spoken answer with it.
export interface ChaosState { fail_next: number; delay_seconds: number; include_tool_calls: boolean }
export const chaos: { [slug: string]: ChaosState } = Object.fromEntries(CLIENTS.map((c) => [c.slug, { fail_next: 0, delay_seconds: 0, include_tool_calls: false }]));

function log(client: Client, entry: Omit<LogEntry, 'at'>): string {
  logs[client.slug].unshift({ at: new Date().toISOString(), ...entry });
  logs[client.slug].length = Math.min(logs[client.slug].length, MAX_LOG);
  console.log(`[${client.slug}] ${entry.type}${entry.call_id ? ` call=${entry.call_id}` : ''} ${entry.detail}`);
  return entry.detail;
}

/** The assistant a message came from. Each client's source should only ever carry its own assistant. */
function assistant_id_of(message: any): string | undefined {
  return message?.call?.assistantId || message?.assistant?.id;
}

/**
 * The slow part of the async tool. Runs after the webhook has been answered:
 * Vapi has already told the model "Success." and will not use anything this request returns.
 */
async function runLookup(client: Client, call_id: string | undefined, tool_call_id: string, customer_name: string, control_url: string | undefined, bytes: number, event_id: string | undefined) {
  await new Promise((resolve) => setTimeout(resolve, LOOKUP_DELAY_MS())); // stands in for a slow CRM
  const record = findCustomer(client, customer_name);
  const summary = record
    ? `${record.name} (${record.phone}): ${record.summary}`
    : `No customer matching "${customer_name}" was found.`;

  if (!control_url) {
    seen_tool_calls.delete(tool_call_id);
    log(client, { type: 'lookup-error', call_id, detail: `${tool_call_id}: no monitor.controlUrl in the payload`, bytes });
    recordFlow({ source: client.source, kind: 'outbound', parent_event_id: event_id, label: 'no controlUrl', detail: 'the payload had no monitor.controlUrl', ok: false });
    return;
  }
  const mode = CONTROL_MODE();
  const started = Date.now();
  try {
    const status = await sendToCall(control_url, mode === 'say'
      ? { type: 'say', content: record ? `Here is what I found. ${record.summary}` : `Sorry, I could not find ${customer_name} in our records.` }
      : { type: 'add-message', message: { role: 'system', content: `CRM result: ${summary}` }, triggerResponseEnabled: true });
    log(client, { type: 'live-call-control', call_id, detail: `${mode} sent for ${tool_call_id}: ${summary}`, bytes: 0 });
    recordFlow({ source: client.source, kind: 'outbound', parent_event_id: event_id, label: `POST controlUrl ${mode}`, detail: summary, status, ok: true, duration_ms: Date.now() - started });
  } catch (error: any) {
    // The result never reached the call, so let a redelivery of this tool call try again
    seen_tool_calls.delete(tool_call_id);
    log(client, { type: 'lookup-error', call_id, detail: `${mode} failed: ${error.message}`, bytes: 0 });
    recordFlow({ source: client.source, kind: 'outbound', parent_event_id: event_id, label: `POST controlUrl ${mode}`, detail: error.message, status: error.status ?? null, ok: false, duration_ms: Date.now() - started });
  }
}

function handleToolCalls(client: Client, message: any, bytes: number, event_id: string | undefined, res: Response): any {
  const call_id = message.call?.id;
  const control_url: string | undefined = message.call?.monitor?.controlUrl;
  if (message.toolCallList !== undefined && !Array.isArray(message.toolCallList)) throw new BadRequestError('toolCallList is not an array');
  const tool_calls: any[] = message.toolCallList || [];
  // Check every tool call before starting any work, so a malformed one never leaves the others half done
  const parsed = tool_calls.map((tool_call) => {
    if (!tool_call || typeof tool_call !== 'object' || typeof tool_call.id !== 'string') throw new BadRequestError('a tool call has no id');
    const name = tool_call.function?.name || tool_call.name;
    let args = tool_call.function?.arguments ?? tool_call.arguments ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { throw new BadRequestError(`arguments of ${tool_call.id} are not valid JSON`); }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new BadRequestError(`arguments of ${tool_call.id} are not an object`);
    return { tool_call, name, args };
  });
  for (const { tool_call, name, args } of parsed) {
    // Hookdeck may redeliver; look each tool call up once. The repeat gets its own log type so the
    // "While you wait" panel does not open a second countdown for it.
    if (hasSeen(tool_call.id)) {
      res.locals.flow_detail = log(client, { type: 'tool-calls-duplicate', call_id, detail: `${name} ${tool_call.id} already started, ignored`, bytes });
      continue;
    }
    res.locals.flow_detail = log(client, { type: 'tool-calls', call_id, detail: `${name}(${JSON.stringify(args)}) controlUrl:${control_url ? 'present' : 'MISSING'}`, bytes });
    markSeen(tool_call.id);
    if (name === 'lookup_customer') {
      // The controlUrl comes from the webhook body: only call a Vapi host
      if (control_url) {
        try { assertControlUrl(control_url); } catch (error: any) {
          seen_tool_calls.delete(tool_call.id);
          log(client, { type: 'lookup-error', call_id, detail: `${tool_call.id}: ${error.message}`, bytes });
          continue;
        }
      }
      runLookup(client, call_id, tool_call.id, String(args.customer_name || '').slice(0, 200), control_url, bytes, event_id).catch((error: any) => {
        seen_tool_calls.delete(tool_call.id);
        log(client, { type: 'lookup-error', call_id, detail: `lookup crashed: ${error?.message ?? error}`, bytes: 0 });
      });
    }
  }
  // An async tool's response is ignored by Vapi; a well-formed one keeps the same route valid for sync tools
  return { results: tool_calls.map((t) => ({ toolCallId: t.id, result: 'Lookup started' })) };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb', verify: (req: any, _res, buf) => { req.raw_bytes = buf.length; } }));

  // One route per client: the client's own endpoint in this simulation
  for (const client of CLIENTS) {
    app.post(client.path, async (req: Request & { raw_bytes?: number }, res: Response) => {
      const message = req.body?.message;
      const bytes = req.raw_bytes || 0;
      // Event Gateway adds the event's ID to every delivery; the pane joins on it
      const event_id = req.header('x-hookdeck-eventid');
      const started = Date.now();
      res.on('finish', () => {
        recordFlow({
          source: client.source, kind: 'result', event_id,
          label: `returned ${res.statusCode}`, detail: res.locals.flow_detail, status: res.statusCode,
          ok: res.statusCode < 400, duration_ms: Date.now() - started,
        });
        deliveries.push({ id: `d${++delivery_count}`, received_at: new Date().toISOString(), client: client.slug, type: describeMessage(message), call_id: message?.call?.id, bytes, status_code: res.statusCode, hookdeck_event_id: event_id });
        if (deliveries.length > MAX_DELIVERIES) deliveries.splice(0, deliveries.length - MAX_DELIVERIES);
      });
      if (!message?.type) return void res.status(400).json({ error: 'not a Vapi server message' });

      const got = assistant_id_of(message);
      const expected = process.env[client.env_assistant_id];
      if (got && expected && got !== expected) {
        res.locals.flow_detail = log(client, { type: 'misrouted', call_id: message.call?.id, detail: `assistant ${got} is not ${client.name}'s`, bytes });
        return void res.status(200).json({ ignored: true });
      }

      // Failure injection (see `chaos`). Checked after the misroute test so only this client's messages count.
      const inject = chaos[client.slug];
      if (message.type !== 'tool-calls' || inject.include_tool_calls) {
        if (inject.delay_seconds > 0) await new Promise((resolve) => setTimeout(resolve, inject.delay_seconds * 1000));
        if (inject.fail_next > 0) {
          inject.fail_next -= 1;
          res.locals.flow_detail = log(client, { type: 'failed-on-purpose', call_id: message.call?.id, detail: `503 for ${message.type}, ${inject.fail_next} more to fail`, bytes });
          return void res.status(503).json({ error: 'failing on purpose' });
        }
      }

      try {
        switch (message.type) {
          case 'status-update':
            res.locals.flow_detail = log(client, { type: 'status-update', call_id: message.call?.id, detail: `status=${message.status}${message.endedReason ? ` (${message.endedReason})` : ''}`, bytes });
            return void res.status(200).json({ ok: true });
          case 'end-of-call-report':
            res.locals.flow_detail = log(client, { type: 'end-of-call-report', call_id: message.call?.id, detail: `endedReason=${message.endedReason} cost=${message.cost ?? message.call?.cost ?? '?'} summary=${(message.analysis?.summary || message.summary || '').slice(0, 120)}`, bytes });
            return void res.status(200).json({ ok: true });
          case 'tool-calls':
            return void res.status(200).json(handleToolCalls(client, message, bytes, event_id, res));
          default:
            res.locals.flow_detail = log(client, { type: message.type, call_id: message.call?.id, detail: '', bytes });
            return void res.status(200).json({ ok: true });
        }
      } catch (error: any) {
        // Malformed content is the sender's problem (400); anything else is ours (500). Neither reaches Express's default handler.
        const bad = error instanceof BadRequestError;
        res.locals.flow_detail = log(client, { type: bad ? 'bad-request' : 'handler-error', call_id: message.call?.id, detail: error?.message ?? String(error), bytes });
        return void res.status(bad ? 400 : 500).json({ error: bad ? error.message : 'internal error' });
      }
    });
  }

  // Topology pane: Event Gateway's requests, events and attempts for both sources (read with the
  // project API key, here on the server) merged with this app's own record of what it did.
  const flow = createFlowState({
    apiKey: process.env.HOOKDECK_API_KEY || '',
    senderLabel: 'Vapi',
    appLabel: 'Demo app',
    sources: CLIENTS.map((c) => ({ name: c.source, label: c.name })),
    appEntries: () => flow_entries,
    // The request's size rides in `detail`, for the pane's packet labels
    describeRequest: ({ body, headers }) => ({ label: describeMessage(body?.message), group: body?.message?.call?.id, detail: headers['content-length'] }),
  });
  const flow_extras = createFlowExtras(process.env.HOOKDECK_API_KEY || '', CLIENTS.map((c) => c.source));
  app.get('/api/flow', async (_req, res) => {
    try {
      const [state, ignored] = await Promise.all([flow.state(), flow_extras.ignoredCounts()]);
      res.json({
        ...state,
        team_id: flow_extras.teamId(),
        messages: state.messages.map((m) => ({ ...m, ignored_count: ignored.get(m.request_id) ?? 0, bytes: Number(m.detail) || null })),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
  // The app's own records, for the topology pane's fast path
  app.get('/api/deliveries', (_req, res) => void res.json(deliveries));
  // Results the app posted into live calls (each client's `controlUrl`)
  app.get('/api/outbound', (_req, res) => void res.json(
    flow_entries.filter((e) => e.kind === 'outbound').map((e) => ({ id: e.id, at: e.at, client: CLIENTS.find((c) => c.source === e.source)?.slug, ok: e.ok === true, label: e.label })),
  ));

  app.get('/api/chaos', (_req, res) => void res.json(chaos));
  app.post('/api/chaos/:slug', (req, res) => {
    const state = chaos[req.params.slug];
    if (!state) return void res.status(404).json({ error: 'unknown client' });
    state.fail_next = Math.max(0, Math.min(10, Math.floor(Number(req.body.fail_next)) || 0));
    state.delay_seconds = Math.max(0, Math.min(25, Math.floor(Number(req.body.delay_seconds)) || 0));
    state.include_tool_calls = req.body.include_tool_calls === true;
    res.json(state);
  });

  app.get('/api/state', (_req, res) => {
    res.json(CLIENTS.map((c) => ({ slug: c.slug, name: c.name, path: c.path, expect_note: c.expect_note, agent_role: c.agent_role, caller_name: c.crm[0].name, caller_note: c.caller_note, events: logs[c.slug] })));
  });
  // Browser-safe config for the Start call buttons. Only the PUBLIC key; VAPI_API_KEY never leaves the server.
  app.get('/api/config', (_req, res) => {
    res.json({
      vapi_public_key: process.env.VAPI_PUBLIC_KEY || null,
      // The "While you wait" panel counts down from this
      lookup_delay_ms: LOOKUP_DELAY_MS(),
      clients: CLIENTS.map((c) => ({ slug: c.slug, name: c.name, assistant_id: process.env[c.env_assistant_id] || null, suggested_line: suggestedLine(c) })),
    });
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Last: a body that is not JSON, or is too large, gets a JSON error, never Express's HTML page with a stack trace
  app.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
    const status = error?.status >= 400 && error?.status < 500 ? error.status : 500;
    console.error(`request error ${status}: ${error?.message ?? error}`);
    res.status(status).json({ error: status === 500 ? 'internal error' : error.type === 'entity.too.large' ? 'body too large' : 'bad request' });
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  // Loopback only: `hookdeck listen` reaches the app from this machine. Set HOST=0.0.0.0 to expose it on the network.
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`Agency routing demo on http://${host}:${port}`);
    for (const c of CLIENTS) {
      if (!process.env[c.env_assistant_id]) console.warn(`  WARNING: ${c.env_assistant_id} is not set, so ${c.name}'s route cannot flag a message from another client's assistant. Run npm run setup.`);
    }
    for (const c of CLIENTS) console.log(`  ${c.name}: ${c.path}  (control mode: ${CONTROL_MODE()})`);
  });
}
