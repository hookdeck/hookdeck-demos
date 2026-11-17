import express, { Request, Response } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ENABLE_LIVE_INJECTION, PORT, RETELL_AGENT_ID, RETELL_EVENTS_URL, RETELL_PUBLIC_KEY, RETELL_SIGNING_KEY, TEST_LEAD_PHONE_NUMBER, missingCallConfig, missingWebCallConfig } from './config';
import { applyRetellEvent, RetellWebhook } from './events';
import { createPhoneCall, updateLiveCall } from './retell';
import { createFlowState } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { listDeliveries, listOutbound, logDelivery, logOutbound, flow_entries } from './deliveries';
import { EVENTS_CONNECTION, FUNCTION_CONNECTION } from './config';
import { MAX_ATTEMPTS, RETRY_DELAY_SECONDS, isRetryDue } from './retry';
import { postSigned, simulatedCallId, simulatedPayload } from './simulated';
import { addLead, addTimeline, findLeadByCall, getLead, Lead, listLeads, updateLead } from './store';

const app = express();
// The raw body's length is the webhook's size, for the topology pane's packets
app.use(express.json({ limit: '5mb', verify: (req: any, _res, buf) => { req.raw_bytes = buf.length; } }));
app.use(express.static(path.join(__dirname, '../public')));

// Failure injection, to show Hookdeck absorbing a slow or failing app
const chaos = { fail_next: 0, delay_seconds: 0 };

const mask = (phone: string) => `${phone.slice(0, 2)}${'•'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-2)}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
app.post('/api/leads', async (req: Request, res: Response) => {
  const missing = missingCallConfig();
  if (missing.length) {
    return res.status(400).json({ error: `Missing configuration: ${missing.join(', ')}` });
  }
  const name = String(req.body.name || '').trim();
  const property_interest = String(req.body.property_interest || '').trim();
  if (!name || !property_interest) {
    return res.status(400).json({ error: 'Name and property are required' });
  }

  const lead_id = randomUUID().replace(/-/g, '').slice(0, 12);
  addLead({
    id: lead_id,
    name,
    property_interest,
    notes: String(req.body.notes || '').trim(),
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
      lead_notes: String(req.body.notes || '').trim(),
    });
    updateLead(lead_id, { call_id, status: 'calling' });
    addTimeline(lead_id, { event: 'call created (API)' });
    logOutbound({ kind: 'start_call', lead_id, call_id, ok: true });
    res.status(201).json({ id: lead_id, call_id });
  } catch (error: any) {
    updateLead(lead_id, { status: 'failed', error: error.message });
    res.status(502).json({ error: error.message });
  }
});

// Browser web call, step 1: the lead arrives. The page then calls Retell itself with the public key
// (RetellClient.createWebCall) and passes back what it gets in step 2. No Retell API key is involved.
app.post('/api/web-leads', (req: Request, res: Response) => {
  const missing = missingWebCallConfig();
  if (missing.length) return res.status(400).json({ error: `Missing configuration: ${missing.join(', ')}` });
  const name = String(req.body.name || '').trim();
  const property_interest = String(req.body.property_interest || '').trim();
  if (!name || !property_interest) return res.status(400).json({ error: 'Name and property are required' });

  const lead_id = randomUUID().replace(/-/g, '').slice(0, 12);
  const notes = String(req.body.notes || '').trim();
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
    // The new call reports its own id; a simulated attempt gets one now
    call_id: lead.simulated ? simulatedCallId(lead) : undefined,
  })!;
  addTimeline(lead.id, { event: `attempt ${lead.attempt} of ${MAX_ATTEMPTS}${lead.simulated ? ' (simulated, no call placed)' : ''}` });
  res.json({ ...webCallRequest(ringing), simulated: !!lead.simulated });
});

// "Lead does not answer": a signed call_ended with dial_no_answer goes to the real Hookdeck source, so it is
// verified, deduplicated and delivered like Retell's own. No Retell call is placed. It rings the simulated
// lead that is waiting for an outcome, or adds one from the form.
app.post('/api/simulate/no-answer', async (req: Request, res: Response) => {
  if (!RETELL_EVENTS_URL || !RETELL_SIGNING_KEY) return res.status(400).json({ error: 'Missing configuration: RETELL_EVENTS_URL (run npm run setup)' });
  let lead = listLeads().find(l => l.simulated && l.status === 'calling');
  if (!lead) {
    const name = String(req.body.name || '').trim() || 'Demo Lead';
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    addLead({
      id, name, property_interest: String(req.body.property_interest || '').trim() || '14 Oak Lane', notes: String(req.body.notes || '').trim(),
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
});

// Step 2: the page reports the call it created (or why it couldn't)
app.post('/api/web-leads/:id/call', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!getLead(id)) return res.status(404).json({ error: 'Unknown lead' });
  if (req.body.error) {
    updateLead(id, { status: 'failed', error: String(req.body.error).slice(0, 300) });
    return res.json({ ok: true });
  }
  const call_id = String(req.body.call_id || '');
  if (!call_id) return res.status(400).json({ error: 'call_id is required' });
  // A fast webhook can win the race; never move the lead backwards
  const lead = getLead(id)!;
  updateLead(id, { call_id, ...(lead.status === 'new' ? { status: 'calling' as const } : {}) });
  addTimeline(id, { event: 'web call created (browser, public key)' });
  logOutbound({ kind: 'start_call', lead_id: id, call_id, ok: true });
  res.json({ ok: true });
});

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
 * Retell call events, delivered by Hookdeck (signature already verified, repeats already
 * deduplicated). Hookdeck acknowledged Retell long ago; a non-2xx here only makes
 * Hookdeck retry this delivery.
 */
app.post('/webhooks/retell', async (req: Request, res: Response) => {
  const started = Date.now();
  const body = req.body as RetellWebhook;
  const hookdeck_event_id = req.header('x-hookdeck-eventid');
  const attempt_info = `event=${hookdeck_event_id} retell_event=${body?.event} call=${body?.call?.call_id}`;

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
  logDelivery({ type: body?.event || 'unknown', call_id: body?.call?.call_id, bytes: (req as any).raw_bytes || 0, status_code: 200, result, hookdeck_event_id }, EVENTS_CONNECTION, started);
  console.log(`✅ ${body.event}: ${result} (${attempt_info})`);
  res.sendStatus(200);
});

/**
 * Optional: the custom function the agent calls mid-call, in "Run in background" mode.
 * Retell doesn't wait for the answer, so the endpoint (a Hookdeck source) just acknowledges.
 * The app does the slow work, then injects the result with update-live-call.
 */
app.post('/webhooks/retell-function', (req: Request, res: Response) => {
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
});

app.listen(PORT, () => {
  const missing = missingCallConfig();
  console.log(`🚀 Retell outbound lead calling on http://localhost:${PORT}`);
  console.log(missing.length ? `⚠️  Not ready to call yet. Missing: ${missing.join(', ')}` : '✅ Ready to place calls');
});
