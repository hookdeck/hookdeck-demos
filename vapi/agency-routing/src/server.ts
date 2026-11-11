import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { CLIENTS, Client, clientBySlug, suggestedLine } from './clients';
import { findCustomer } from './crm';
import { sendToCall } from './live-call-control';

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

function log(client: Client, entry: Omit<LogEntry, 'at'>): void {
  logs[client.slug].unshift({ at: new Date().toISOString(), ...entry });
  logs[client.slug].length = Math.min(logs[client.slug].length, MAX_LOG);
  console.log(`[${client.slug}] ${entry.type}${entry.call_id ? ` call=${entry.call_id}` : ''} ${entry.detail}`);
}

/** The assistant a message came from. Each client's source should only ever carry its own assistant. */
function assistant_id_of(message: any): string | undefined {
  return message?.call?.assistantId || message?.assistant?.id;
}

/**
 * The slow part of the async tool. Runs after the webhook has been answered:
 * Vapi has already told the model "Success." and will not use anything this request returns.
 */
async function runLookup(client: Client, call_id: string | undefined, tool_call_id: string, customer_name: string, control_url: string | undefined, bytes: number) {
  await new Promise((resolve) => setTimeout(resolve, LOOKUP_DELAY_MS())); // stands in for a slow CRM
  const record = findCustomer(client, customer_name);
  const summary = record
    ? `${record.name} (${record.phone}): ${record.summary}`
    : `No customer matching "${customer_name}" was found.`;

  if (!control_url) {
    log(client, { type: 'lookup-error', call_id, detail: `${tool_call_id}: no monitor.controlUrl in the payload`, bytes });
    return;
  }
  const mode = CONTROL_MODE();
  try {
    await sendToCall(control_url, mode === 'say'
      ? { type: 'say', content: record ? `Here is what I found. ${record.summary}` : `Sorry, I could not find ${customer_name} in our records.` }
      : { type: 'add-message', message: { role: 'system', content: `CRM result: ${summary}` }, triggerResponseEnabled: true });
    log(client, { type: 'live-call-control', call_id, detail: `${mode} sent for ${tool_call_id}: ${summary}`, bytes: 0 });
  } catch (error: any) {
    log(client, { type: 'lookup-error', call_id, detail: `${mode} failed: ${error.message}`, bytes: 0 });
  }
}

function handleToolCalls(client: Client, message: any, bytes: number): any {
  const call_id = message.call?.id;
  const control_url: string | undefined = message.call?.monitor?.controlUrl;
  const tool_calls: any[] = message.toolCallList || [];
  for (const tool_call of tool_calls) {
    const name = tool_call.function?.name || tool_call.name;
    let args = tool_call.function?.arguments ?? tool_call.arguments ?? {};
    if (typeof args === 'string') args = JSON.parse(args);
    log(client, { type: 'tool-calls', call_id, detail: `${name}(${JSON.stringify(args)}) controlUrl:${control_url ? 'present' : 'MISSING'}`, bytes });
    // Hookdeck may redeliver; look each tool call up once
    if (seen_tool_calls.has(tool_call.id)) continue;
    seen_tool_calls.add(tool_call.id);
    if (name === 'lookup_customer') {
      void runLookup(client, call_id, tool_call.id, String(args.customer_name || ''), control_url, bytes);
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
    app.post(client.path, (req: Request & { raw_bytes?: number }, res: Response) => {
      const message = req.body?.message;
      const bytes = req.raw_bytes || 0;
      if (!message?.type) return void res.status(400).json({ error: 'not a Vapi server message' });

      const got = assistant_id_of(message);
      const expected = process.env[client.env_assistant_id];
      if (got && expected && got !== expected) {
        log(client, { type: 'misrouted', call_id: message.call?.id, detail: `assistant ${got} is not ${client.name}'s`, bytes });
        return void res.status(200).json({ ignored: true });
      }

      switch (message.type) {
        case 'status-update':
          log(client, { type: 'status-update', call_id: message.call?.id, detail: `status=${message.status}${message.endedReason ? ` (${message.endedReason})` : ''}`, bytes });
          return void res.status(200).json({ ok: true });
        case 'end-of-call-report':
          log(client, { type: 'end-of-call-report', call_id: message.call?.id, detail: `endedReason=${message.endedReason} cost=${message.cost ?? message.call?.cost ?? '?'} summary=${(message.analysis?.summary || message.summary || '').slice(0, 120)}`, bytes });
          return void res.status(200).json({ ok: true });
        case 'tool-calls':
          return void res.status(200).json(handleToolCalls(client, message, bytes));
        default:
          log(client, { type: message.type, call_id: message.call?.id, detail: '', bytes });
          return void res.status(200).json({ ok: true });
      }
    });
  }

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
