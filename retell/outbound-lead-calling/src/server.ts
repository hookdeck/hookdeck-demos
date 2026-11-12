import express, { Request, Response } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ENABLE_LIVE_INJECTION, PORT, TEST_LEAD_PHONE_NUMBER, missingCallConfig, missingWebCallConfig } from './config';
import { applyRetellEvent, RetellWebhook } from './events';
import { createPhoneCall, createWebCall, updateLiveCall } from './retell';
import { addLead, addTimeline, findLeadByCall, listLeads, updateLead } from './store';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Failure injection, to show Hookdeck absorbing a slow or failing app
const chaos = { fail_next: 0, delay_seconds: 0 };

const mask = (phone: string) => `${phone.slice(0, 2)}${'•'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-2)}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/config', (_req, res) => {
  res.json({ missing: missingCallConfig(), web_missing: missingWebCallConfig(), live_injection: ENABLE_LIVE_INJECTION, chaos });
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
    res.status(201).json({ id: lead_id, call_id });
  } catch (error: any) {
    updateLead(lead_id, { status: 'failed', error: error.message });
    res.status(502).json({ error: error.message });
  }
});

// Start call: a lead plus a browser (web) call to the same agent. The API key stays on the server;
// the page gets a short-lived access token for retell-client-js-sdk.
app.post('/api/web-call', async (req: Request, res: Response) => {
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
  try {
    const call = await createWebCall({ lead_id, lead_name: name, property_interest, lead_notes: notes });
    updateLead(lead_id, { call_id: call.call_id, status: 'calling' });
    addTimeline(lead_id, { event: 'web call created (API)' });
    res.status(201).json({ id: lead_id, ...call });
  } catch (error: any) {
    updateLead(lead_id, { status: 'failed', error: error.message });
    res.status(502).json({ error: error.message });
  }
});

// A lead without a call, for `npm run simulate` and trying the UI before real keys are in place
app.post('/api/leads/demo', (_req, res) => {
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  addLead({
    id,
    name: 'Demo Lead',
    property_interest: '14 Oak Lane',
    notes: 'Simulated lead, no call placed',
    phone_masked: mask('+15555550123'),
    status: 'calling',
    created_at: new Date().toISOString(),
    call_id: `simulated_${id}`,
    timeline: [{ at: new Date().toISOString(), event: 'simulated lead (no call placed)' }],
  });
  res.status(201).json({ id, call_id: `simulated_${id}` });
});

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
    return res.status(503).json({ error: 'simulated outage' });
  }

  const result = applyRetellEvent(body, { hookdeck_event_id });
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
    } catch (error: any) {
      console.error(`❌ ${error.message}`);
      if (lead) addTimeline(lead.id, { event: 'update-live-call failed', note: error.message });
    }
  }, 4000);
});

app.listen(PORT, () => {
  const missing = missingCallConfig();
  console.log(`🚀 Retell outbound lead calling on http://localhost:${PORT}`);
  console.log(missing.length ? `⚠️  Not ready to call yet. Missing: ${missing.join(', ')}` : '✅ Ready to place calls');
});
