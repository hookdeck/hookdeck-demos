import express, { NextFunction, Request, Response } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ENABLE_LIVE_INJECTION, HOST, PHONE_DIAL_MIN_INTERVAL_SECONDS, PORT, RETELL_AGENT_ID, RETELL_EVENTS_URL, RETELL_PUBLIC_KEY, RETELL_SIGNING_KEY, TEST_LEAD_PHONE_NUMBER, missingCallConfig, missingWebCallConfig } from './config';
import { advance, applyRetellEvent, RANK, RetellWebhook } from './events';
import { createPhoneCall, updateLiveCall } from './retell';
import { createFlowState } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { listDeliveries, listOutbound, logDelivery, logOutbound, flow_entries } from './deliveries';
import { EVENTS_CONNECTION, FUNCTION_CONNECTION } from './config';
import { MAX_ATTEMPTS, RETRY_DELAY_SECONDS, isRetryDue } from './retry';
import { postSigned, simulatedCallId, simulatedPayload } from './simulated';
import { requireHookdeckSigningSecret, verifyHookdeckSignature } from './hookdeck-signature';
import { addLead, addTimeline, findLeadByCall, getLead, Lead, listLeads, updateLead } from './store';

const app = express();
// The raw body's length is the webhook's size, for the topology pane's packets
app.use(express.json({ limit: '5mb', verify: (req: any, _res, buf) => { req.raw_body = Buffer.from(buf); req.raw_bytes = buf.length; } }));
app.use(express.static(path.join(__dirname, '../public')));

// Failure injection, to show Hookdeck absorbing a slow or failing app
const chaos = { fail_next: 0, delay_seconds: 0 };

const mask = (phone: string) => `${phone.slice(0, 2)}${'•'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-2)}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Form text goes into the agent's dynamic variables, so it is capped before it is stored or sent
const FIELD_MAX = { name: 80, property_interest: 120, notes: 500 };
const field = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max);

// Express 4 does not catch a rejected promise from an async handler: pass it to the error handler instead
const safe = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
let last_phone_dial = 0;

app.get('/api/config', (_req, res) => {
  const web_missing = missingWebCallConfig();
  // The public key is meant for the browser; the API key never leaves the server
  res.json({
    missing: missingCallConfig(),
    web_missing,
    retell_public_key: web_missing.length ? undefined : RETELL_PUBLIC_KEY,
    agent_id: RETELL_AGENT_ID || undefined,
    simulate_missing: RETELL_EVENTS_URL && RETELL_SIGNING_KEY ? [] : ['RETELL_EVENTS_URL (run npm run setup)'],
    retry: { max_attempts: MAX_ATTEMPTS, delay_seconds: RETRY_DELAY_SECONDS },
    live_injection: ENABLE_LIVE_INJECTION, chaos });
});

app.get('/api/leads', (_req, res) => {
  res.json(listLeads());
});

// A lead arrives (the demo's stand-in for a form on your site or a CRM)
app.post('/api/leads', safe(async (req: Request, res: Response) => {
  const missing = missingCallConfig();
  if (missing.length) {
    return res.status(400).json({ error: `Missing configuration: ${missing.join(', ')}` });
  }
  const name = field(req.body?.name, FIELD_MAX.name);
  const property_interest = field(req.body?.property_interest, FIELD_MAX.property_interest);
  const notes = field(req.body?.notes, FIELD_MAX.notes);
  if (!name || !property_interest) {
    return res.status(400).json({ error: 'Name and property are required' });
  }
  // The demo dials one real number: a minimum gap stops a loop or a double submit from ringing it repeatedly
  const wait_seconds = Math.ceil((last_phone_dial + PHONE_DIAL_MIN_INTERVAL_SECONDS * 1000 - Date.now()) / 1000);
  if (wait_seconds > 0) return res.status(429).json({ error: `The last phone call was placed moments ago. Try again in ${wait_seconds}s` });
  last_phone_dial = Date.now();

  const lead_id = randomUUID().replace(/-/g, '').slice(0, 12);
  addLead({
    id: lead_id,
    name,
    property_interest,
    notes,
    phone_masked: mask(TEST_LEAD_PHONE_NUMBER),
    status: 'new',
    created_at: new Date().toISOString(),
    timeline: [],
  });

  try {
    const { call_id } = await createPhoneCall({
      lead_id,
      // The form never takes a number: the demo only dials the one in .env
      to_number: TEST_LEAD_PHONE_NUMBER,
      lead_name: name,
      property_interest,
      lead_notes: notes,
      attempt: 1,
    });
    // A fast webhook can win the race during the await above; never move the lead backwards
    updateLead(lead_id, { call_id, status: advance(getLead(lead_id)!, 'calling') });
    addTimeline(lead_id, { event: 'call created (API)' });
    logOutbound({ kind: 'start_call', lead_id, call_id, ok: true });
    res.status(201).json({ id: lead_id, call_id });
  } catch (error: any) {
    updateLead(lead_id, { status: 'failed', error: error.message });
    res.status(502).json({ error: error.message });
  }
}));

// Browser web call, step 1: the lead arrives. The page then calls Retell itself with the public key
// (RetellClient.createWebCall) and passes back what it gets in step 2. No Retell API key is involved.
app.post('/api/web-leads', (req: Request, res: Response) => {
  const missing = missingWebCallConfig();
  if (missing.length) return res.status(400).json({ error: `Missing configuration: ${missing.join(', ')}` });
  const name = field(req.body?.name, FIELD_MAX.name);
  const property_interest = field(req.body?.property_interest, FIELD_MAX.property_interest);
  if (!name || !property_interest) return res.status(400).json({ error: 'Name and property are required' });

  const lead_id = randomUUID().replace(/-/g, '').slice(0, 12);
  const notes = field(req.body?.notes, FIELD_MAX.notes);
  addLead({
    id: lead_id, name, property_interest, notes,
    phone_masked: 'web call (browser)',
    status: 'new',
    created_at: new Date().toISOString(),
    timeline: [],
  });
  res.status(201).json(webCallRequest(getLead(lead_id)!));
});

// What the page sends to Retell: `metadata.lead_id` comes back on every webhook for the call
const webCallRequest = (lead: Lead) => ({
  id: lead.id,
  agent_id: RETELL_AGENT_ID,
  retell_llm_dynamic_variables: { lead_name: lead.name, property_interest: lead.property_interest, lead_notes: lead.notes || 'none' },
  metadata: { lead_id: lead.id },
});

// The retry ladder's next ring, once the countdown has run out. The app does not dial by itself: the page
// starts the next web call on this same lead (or, for a simulated lead, waits for a simulated outcome).
app.post('/api/leads/:id/retry', (req: Request, res: Response) => {
  const lead = getLead(String(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Unknown lead' });
  if (!isRetryDue(lead)) return res.status(409).json({ error: lead.next_attempt_at ? 'The next attempt is not due yet' : 'No attempt is waiting' });
  const ringing = updateLead(lead.id, {
    status: 'calling', next_attempt_at: undefined, disconnection_reason: undefined, duration_seconds: undefined,
    // The previous attempt's call id moves to past_call_ids so its late events are recognised as stale
    past_call_ids: lead.call_id ? [...(lead.past_call_ids || []), lead.call_id] : lead.past_call_ids,
    // If the new call fails to start (the page reports an error), this puts the ladder back as it was
    retry_backup: { status: lead.status, next_attempt_at: lead.next_attempt_at, disconnection_reason: lead.disconnection_reason, duration_seconds: lead.duration_seconds, call_id: lead.call_id },
    // The new call reports its own id; a simulated attempt gets one now
    call_id: lead.simulated ? simulatedCallId(lead) : undefined,
  })!;
  addTimeline(lead.id, { event: `attempt ${lead.attempt} of ${MAX_ATTEMPTS}${lead.simulated ? ' (simulated, no call placed)' : ''}` });
  res.json({ ...webCallRequest(ringing), simulated: !!lead.simulated });
});

// "Lead does not answer": a signed call_ended with dial_no_answer goes to the real Hookdeck source, so it is
// verified, deduplicated and delivered like Retell's own. No Retell call is placed. It rings the simulated
// lead that is waiting for an outcome, or adds one from the form.
app.post('/api/simulate/no-answer', safe(async (req: Request, res: Response) => {
  if (!RETELL_EVENTS_URL || !RETELL_SIGNING_KEY) return res.status(400).json({ error: 'Missing configuration: RETELL_EVENTS_URL (run npm run setup)' });
  let lead = listLeads().find(l => l.simulated && l.status === 'calling');
  if (!lead) {
    const name = field(req.body?.name, FIELD_MAX.name) || 'Demo Lead';
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    addLead({
      id, name, property_interest: field(req.body?.property_interest, FIELD_MAX.property_interest) || '14 Oak Lane', notes: field(req.body?.notes, FIELD_MAX.notes),
      phone_masked: 'simulated, no call placed', status: 'calling', created_at: new Date().toISOString(),
      call_id: `simulated_${id}`, simulated: true, timeline: [{ at: new Date().toISOString(), event: 'simulated lead (no call placed)' }],
    });
    lead = getLead(id)!;
  }
  try {
    const status = await postSigned(RETELL_EVENTS_URL, RETELL_SIGNING_KEY, simulatedPayload('call_ended', lead, lead.call_id || simulatedCallId(lead), 'dial_no_answer'));
    res.status(status < 400 ? 202 : 502).json({ id: lead.id, hookdeck_status: status });
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
}));

// Step 2: the page reports the call it created (or why it couldn't)
app.post('/api/web-leads/:id/call', safe((req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!getLead(id)) return res.status(404).json({ error: 'Unknown lead' });
  const current = getLead(id)!;
  if (req.body?.error) {
    const error = String(req.body.error).slice(0, 300);
    if (current.retry_backup) {
      // The retry's call never started: put the ladder back so the lead is not stranded
      updateLead(id, { ...current.retry_backup, retry_backup: undefined, error });
      addTimeline(id, { event: 'retry call failed to start, ladder restored', note: error });
    } else if (RANK[current.status] < RANK.completed) {
      // A webhook may have moved the lead further already (a call that connected and then errored in the browser)
      updateLead(id, { status: 'failed', error });
    } else {
      updateLead(id, { error });
    }
    return res.json({ ok: true });
  }
  const call_id = String(req.body?.call_id || '');
  if (!call_id) return res.status(400).json({ error: 'call_id is required' });
  // A fast webhook can win the race; never move the lead backwards
  updateLead(id, { call_id, status: advance(current, 'calling'), retry_backup: undefined });
  addTimeline(id, { event: 'web call created (browser, public key)' });
  logOutbound({ kind: 'start_call', lead_id: id, call_id, ok: true });
  res.json({ ok: true });
}));

// A lead without a call, for `npm run simulate` and trying the UI before real keys are in place
app.post('/api/leads/demo', (_req, res) => {
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  addLead({
    id,
    name: 'Demo Lead',
    property_interest: '14 Oak Lane',
    notes: 'Simulated lead, no call placed',
    phone_masked: 'simulated, no call placed',
    simulated: true,
    status: 'calling',
    created_at: new Date().toISOString(),
    call_id: `simulated_${id}`,
    timeline: [{ at: new Date().toISOString(), event: 'simulated lead (no call placed)' }],
  });
  res.status(201).json({ id, call_id: `simulated_${id}` });
});

// Topology pane data. /api/deliveries and /api/outbound are the app's own record (fast); /api/flow is
// Event Gateway's requests, events and delivery attempts, read with the project API key here on the
// server and merged with what this app answered.
app.get('/api/deliveries', (_req, res) => res.json(listDeliveries()));
app.get('/api/outbound', (_req, res) => res.json(listOutbound()));
const flow_sources = [{ name: EVENTS_CONNECTION, label: 'Retell' }, ...(ENABLE_LIVE_INJECTION ? [{ name: FUNCTION_CONNECTION, label: 'Retell function' }] : [])];
const flow = createFlowState({
  apiKey: process.env.HOOKDECK_API_KEY || '',
  senderLabel: 'Retell',
  appLabel: 'Demo app',
  // For RETELL sources, Event Gateway answers a bad signature with 200
  rejectedStatus: 200,
  sources: flow_sources,
  appEntries: () => flow_entries,
  describeRequest: ({ body, headers }) => ({
    label: body?.event ?? body?.name ?? 'not a Retell event',
    group: body?.call?.call_id,
    // The request's size, for the pane's packets
    detail: headers['content-length'],
  }),
});
const flow_extras = createFlowExtras(process.env.HOOKDECK_API_KEY || '', EVENTS_CONNECTION);
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
app.get('/api/state', (_req, res) => res.json({ fail_next: chaos.fail_next, delay_seconds: chaos.delay_seconds, live_injection: ENABLE_LIVE_INJECTION }));

// Chaos controls: the next N deliveries fail with 503, and/or each takes N seconds to answer
app.post('/api/chaos', (req, res) => {
  chaos.fail_next = Math.max(0, Math.min(10, Number(req.body.fail_next) || 0));
  chaos.delay_seconds = Math.max(0, Math.min(60, Number(req.body.delay_seconds) || 0));
  res.json(chaos);
});

/**
 * Verifies Hookdeck's signature on the raw body of a delivery, before any handler runs. A missing or wrong
 * signature gets a 401 and is recorded as `signature_rejected` in the deliveries the page shows. The signature
 * has no timestamp: Event Gateway verified the sender's signature when it accepted the request, so a retry or a
 * replay from hours ago is legitimate and still passes.
 */
function requireHookdeckSignature(connection: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    const raw_body: Buffer = (req as any).raw_body ?? Buffer.alloc(0);
    if (verifyHookdeckSignature(raw_body, req.header('x-hookdeck-signature'), process.env.HOOKDECK_SIGNING_SECRET, req.header('x-hookdeck-signature-2'))) return next();
    console.warn(`🚫 ${req.path}: x-hookdeck-signature ${req.header('x-hookdeck-signature') ? 'does not match the body' : 'is missing'}, rejected`);
    logDelivery({ type: 'unverified', bytes: raw_body.length, status_code: 401, result: 'signature_rejected', hookdeck_event_id: req.header('x-hookdeck-eventid') }, connection, started);
    res.status(401).json({ error: 'invalid Hookdeck signature' });
  };
}

/**
 * Retell call events, delivered by Hookdeck (Retell's signature already verified by Event Gateway, repeats already
 * deduplicated). Hookdeck acknowledged Retell long ago; a non-2xx here only makes
 * Hookdeck retry this delivery.
 */
app.post('/webhooks/retell', requireHookdeckSignature(EVENTS_CONNECTION), async (req: Request, res: Response) => {
  const started = Date.now();
  const body = req.body as RetellWebhook;
  const hookdeck_event_id = req.header('x-hookdeck-eventid');
  const attempt_info = `event=${hookdeck_event_id} retell_event=${body?.event} call=${body?.call?.call_id}`;

  try {
    if (chaos.delay_seconds) {
      console.log(`⏳ Delaying ${chaos.delay_seconds}s before answering (${attempt_info})`);
      await sleep(chaos.delay_seconds * 1000);
    }
    if (chaos.fail_next > 0) {
      chaos.fail_next -= 1;
      console.log(`💥 Failing on purpose with 503 (${attempt_info}), ${chaos.fail_next} more to go`);
      logDelivery({ type: body?.event || 'unknown', call_id: body?.call?.call_id, bytes: (req as any).raw_bytes || 0, status_code: 503, result: 'simulated_failure', hookdeck_event_id }, EVENTS_CONNECTION, started);
      return res.status(503).json({ error: 'simulated outage' });
    }

    const result = applyRetellEvent(body, { hookdeck_event_id });
    // An event that is not a Retell call event will never succeed on retry, so it is a 400.
    // An unknown lead (for example data/ was wiped) is acknowledged with 200: a retry could not find the lead either,
    // and Hookdeck would otherwise keep redelivering it.
    const status_code = result === 'invalid' ? 400 : 200;
    logDelivery({ type: body?.event || 'unknown', call_id: body?.call?.call_id, bytes: (req as any).raw_bytes || 0, status_code, result, hookdeck_event_id }, EVENTS_CONNECTION, started);
    if (result === 'unknown_lead') console.warn(`⚠️  No lead for this call, acknowledged and dropped (${attempt_info})`);
    else console.log(`${result === 'invalid' ? '⚠️ ' : '✅'} ${body?.event}: ${result} (${attempt_info})`);
    if (result === 'invalid') return res.status(400).json({ error: 'not a Retell call event' });
    res.sendStatus(200);
  } catch (error: any) {
    // Never an unhandled rejection; a 500 makes Hookdeck retry the delivery
    console.error(`❌ ${attempt_info}: ${error?.stack || error}`);
    logDelivery({ type: body?.event || 'unknown', call_id: body?.call?.call_id, bytes: (req as any).raw_bytes || 0, status_code: 500, result: 'error', hookdeck_event_id }, EVENTS_CONNECTION, started);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  }
});

/**
 * Optional: the custom function the agent calls mid-call, in "Run in background" mode.
 * Retell doesn't wait for the answer, so the endpoint (a Hookdeck source) just acknowledges.
 * The app does the slow work, then injects the result with update-live-call.
 */
app.post('/webhooks/retell-function', requireHookdeckSignature(FUNCTION_CONNECTION), safe((req: Request, res: Response) => {
  res.sendStatus(200);

  const { call, args } = req.body || {};
  logDelivery({ type: String(req.body?.name || 'function'), call_id: call?.call_id, bytes: (req as any).raw_bytes || 0, status_code: 200, result: 'acknowledged', hookdeck_event_id: req.header('x-hookdeck-eventid') }, FUNCTION_CONNECTION, Date.now());
  const call_id: string | undefined = call?.call_id;
  if (!call_id) return;
  const lead = findLeadByCall(call_id);
  const day = String(args?.preferred_day || 'this week');
  console.log(`📞 Function called on call ${call_id} for "${day}"`);
  if (lead) addTimeline(lead.id, { event: `function: check_viewing_slots(${day})`, hookdeck_event_id: req.header('x-hookdeck-eventid') });

  // Stand-in for a slow calendar or CRM lookup
  setTimeout(async () => {
    const slots = '10:00, 14:30 and 17:00';
    try {
      await updateLiveCall(
        call_id,
        `Viewing slots available on ${day}: ${slots}. Offer these to the caller and ask which one they prefer.`
      );
      if (lead) addTimeline(lead.id, { event: 'update-live-call: slots injected' });
      logOutbound({ kind: 'update_live_call', lead_id: lead?.id, call_id, ok: true });
    } catch (error: any) {
      console.error(`❌ ${error.message}`);
      if (lead) addTimeline(lead.id, { event: 'update-live-call failed', note: error.message });
      logOutbound({ kind: 'update_live_call', lead_id: lead?.id, call_id, ok: false });
    }
  }, 4000);
}));

// Last: JSON errors, no stack traces. Malformed JSON is the caller's fault (400); anything else is ours (500).
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = error?.status >= 400 && error?.status < 500 ? error.status : 500;
  if (status === 500) console.error(`❌ ${error?.stack || error}`);
  if (!res.headersSent) res.status(status).json({ error: status === 500 ? 'internal error' : (error.type === 'entity.parse.failed' ? 'invalid JSON' : 'bad request') });
});

requireHookdeckSigningSecret();
app.listen(PORT, HOST, () => {
  const missing = missingCallConfig();
  console.log(`🚀 Retell outbound lead calling on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(missing.length ? `⚠️  Not ready to call yet. Missing: ${missing.join(', ')}` : '✅ Ready to place calls');
});
