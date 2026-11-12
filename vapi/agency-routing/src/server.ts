import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { CLIENTS, Client, clientBySlug, suggestedLine } from './clients';
import { findCustomer } from './crm';
import { sendToCall } from './live-call-control';
import { createFlowState, AppFlowEntry } from './flow-drawer-server';

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
const seen_tool_calls = new Set<string>();

// What this app did, for the data-flow drawer: one `result` per delivery it answered, and one
// `outbound` per call it made back to Vapi. The drawer joins them to Event Gateway's events by ID.
const MAX_FLOW = 300;
export const flow_entries: AppFlowEntry[] = [];
function recordFlow(entry: Omit<AppFlowEntry, 'id' | 'at'>): void {
  flow_entries.push({ id: `${Date.now()}-${flow_entries.length}`, at: new Date().toISOString(), ...entry });
  if (flow_entries.length > MAX_FLOW) flow_entries.splice(0, flow_entries.length - MAX_FLOW);
}

// Failure injection, per client: the next N deliveries get a 503 (and/or every answer is slow), so the
// data-flow drawer can show Hookdeck retrying. Vapi is never affected: Event Gateway has already answered it.
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
    log(client, { type: 'lookup-error', call_id, detail: `${mode} failed: ${error.message}`, bytes: 0 });
    recordFlow({ source: client.source, kind: 'outbound', parent_event_id: event_id, label: `POST controlUrl ${mode}`, detail: error.message, status: error.status ?? null, ok: false, duration_ms: Date.now() - started });
  }
}

function handleToolCalls(client: Client, message: any, bytes: number, event_id: string | undefined, res: Response): any {
  const call_id = message.call?.id;
  const control_url: string | undefined = message.call?.monitor?.controlUrl;
  const tool_calls: any[] = message.toolCallList || [];
  for (const tool_call of tool_calls) {
    const name = tool_call.function?.name || tool_call.name;
    let args = tool_call.function?.arguments ?? tool_call.arguments ?? {};
    if (typeof args === 'string') args = JSON.parse(args);
    res.locals.flow_detail = log(client, { type: 'tool-calls', call_id, detail: `${name}(${JSON.stringify(args)}) controlUrl:${control_url ? 'present' : 'MISSING'}`, bytes });
    // Hookdeck may redeliver; look each tool call up once
    if (seen_tool_calls.has(tool_call.id)) continue;
    seen_tool_calls.add(tool_call.id);
    if (name === 'lookup_customer') {
      void runLookup(client, call_id, tool_call.id, String(args.customer_name || ''), control_url, bytes, event_id);
    }
  }
  // An async tool's response is ignored by Vapi; a well-formed one keeps the same route valid for sync tools
  return { results: tool_calls.map((t) => ({ toolCallId: t.id, result: 'Lookup started' })) };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb', verify: (req: any, _res, buf) => { req.raw_bytes = buf.length; } }));

  // One route per client: the client's own endpoint in this simulation
  for (const client of CLIENTS) {
    app.post(client.path, async (req: Request & { raw_bytes?: number }, res: Response) => {
      const message = req.body?.message;
      const bytes = req.raw_bytes || 0;
      // Event Gateway adds the event's ID to every delivery; the drawer joins on it
      const event_id = req.header('x-hookdeck-eventid');
      const started = Date.now();
      res.on('finish', () => recordFlow({
        source: client.source, kind: 'result', event_id,
        label: `returned ${res.statusCode}`, detail: res.locals.flow_detail, status: res.statusCode,
        ok: res.statusCode < 400, duration_ms: Date.now() - started,
      }));
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
    });
  }

  // Data-flow drawer: Event Gateway's requests, events and attempts for both sources (read with the
  // project API key, here on the server) merged with this app's own record of what it did.
  const flow = createFlowState({
    apiKey: process.env.HOOKDECK_API_KEY || '',
    senderLabel: 'Vapi',
    appLabel: 'Demo app',
    sources: CLIENTS.map((c) => ({ name: c.source, label: c.name })),
    appEntries: () => flow_entries,
    describeRequest: ({ body }) => {
      const message = body?.message;
      if (!message?.type) return { label: 'not a Vapi message' };
      const tool = message.toolCallList?.[0]?.function?.name ?? message.toolCalls?.[0]?.function?.name;
      const extra = message.type === 'tool-calls' ? tool : message.type === 'status-update' ? message.status : undefined;
      return { label: extra ? `${message.type} \u00b7 ${extra}` : message.type, group: message.call?.id };
    },
  });
  app.get('/api/flow', (req, res) => void flow.handler(req, res));

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
    res.json(CLIENTS.map((c) => ({ slug: c.slug, name: c.name, path: c.path, expect_note: c.expect_note, events: logs[c.slug] })));
  });
  // Browser-safe config for the Start call buttons. Only the PUBLIC key; VAPI_API_KEY never leaves the server.
  app.get('/api/config', (_req, res) => {
    res.json({
      vapi_public_key: process.env.VAPI_PUBLIC_KEY || null,
      clients: CLIENTS.map((c) => ({ slug: c.slug, name: c.name, assistant_id: process.env[c.env_assistant_id] || null, suggested_line: suggestedLine(c) })),
    });
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  createApp().listen(port, () => {
    console.log(`Agency routing demo on http://localhost:${port}`);
    for (const c of CLIENTS) console.log(`  ${c.name}: ${c.path}  (control mode: ${CONTROL_MODE()})`);
  });
}
