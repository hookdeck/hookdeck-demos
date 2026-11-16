import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { WebhookReceiver } from 'livekit-server-sdk';
import { applyEvent, LiveKitEvent, summarise } from './call-log';
import { loadLog, readDeliveries, recordDelivery, saveLog } from './store';
import { CONNECTION, PORT, SOURCE_TYPE } from './config';
import { createFlowState } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { flow_entries, listDeliveries, logDelivery } from './deliveries';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || LIVEKIT_API_KEY.startsWith('your_')) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set. See .env.example.');
  process.exit(1);
}

const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const log = loadLog();

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

// Failure injection, to show Hookdeck absorbing a slow or failing app
const chaos = { fail_next: 0, delay_seconds: 0 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * LiveKit webhook endpoint (via Hookdeck).
 *
 * LiveKit sends `Content-Type: application/webhook+json`, which express.json() ignores,
 * so read the body raw. The signature covers the exact bytes: the Authorization header is
 * a JWT whose `sha256` claim is the hash of the body.
 */
app.post('/webhooks/livekit', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const started = Date.now();
  const raw_body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const hookdeck_event_id = req.header('x-hookdeck-eventid');
  let peek: any = {};
  try { peek = JSON.parse(raw_body.toString('utf-8')); } catch { /* not JSON: WebhookReceiver rejects it below */ }
  const event_name: string | undefined = peek.event;
  const room_name: string | undefined = peek.room?.name ?? peek.egressInfo?.roomName;
  const answered = (status_code: number, result: string) =>
    logDelivery({ type: event_name || 'unknown', room: room_name, bytes: raw_body.length, status_code, result, hookdeck_event_id }, CONNECTION, started);

  if (chaos.delay_seconds) await sleep(chaos.delay_seconds * 1000);
  if (chaos.fail_next > 0) {
    chaos.fail_next -= 1;
    console.log(`Failing on purpose with 503 (${event_name}), ${chaos.fail_next} more to go`);
    answered(503, 'simulated_failure');
    return res.status(503).json({ error: 'simulated outage' });
  }
  const delivery = {
    received_at: new Date().toISOString(),
    headers: req.headers,
    body_base64: raw_body.toString('base64'),
  };

  try {
    // Verifies the JWT signature and the body hash. Throws if either fails.
    await receiver.receive(raw_body.toString('utf-8'), req.get('authorization'));
  } catch (error: any) {
    console.warn(`Rejected webhook: ${error.message}`);
    recordDelivery({ ...delivery, verified: false, duplicate: false, error: error.message });
    answered(401, 'rejected');
    // Non-2xx: Hookdeck keeps the event and can retry it
    return res.status(401).json({ error: 'invalid signature' });
  }

  // Use the plain JSON for the call log (the SDK parses it into protobuf types)
  const event = JSON.parse(raw_body.toString('utf-8')) as LiveKitEvent;
  const { duplicate } = applyEvent(log, event);
  saveLog(log);
  recordDelivery({ ...delivery, event_id: event.id, event: event.event, verified: true, duplicate });
  answered(200, duplicate ? 'duplicate' : 'applied');
  console.log(`${duplicate ? 'Duplicate' : 'Applied'} ${event.event} ${event.id} (${event.room?.name ?? event.egressInfo?.roomName ?? ''})`);
  res.json({ ok: true });
});

app.get('/api/calls', (_req, res) => res.json(summarise(log)));
app.get('/api/deliveries', (_req, res) => res.json(readDeliveries()));
// Topology pane data. /api/deliveries is the app's own record (fast); /api/flow is Event Gateway's
// requests, events and delivery attempts, read with the project API key here on the server and
// merged with what this app answered.
app.get('/api/answered', (_req, res) => res.json(listDeliveries()));
const flow = createFlowState({
  apiKey: process.env.HOOKDECK_API_KEY || '',
  senderLabel: 'LiveKit',
  appLabel: 'Call log',
  // Only a LIVEKIT source type can reject a request; Event Gateway then answers the sender 200
  rejectedStatus: 200,
  sources: [{ name: CONNECTION, label: 'LiveKit' }],
  appEntries: () => flow_entries,
  describeRequest: ({ body, headers }) => ({
    label: body?.event ?? 'not a LiveKit event',
    group: body?.room?.sid,
    // The request's size, for the pane's packets
    detail: headers['content-length'],
  }),
});
const flow_extras = createFlowExtras(process.env.HOOKDECK_API_KEY || '', CONNECTION);
app.get('/api/flow', async (_req, res) => {
  try {
    const [state, ignored] = await Promise.all([flow.state(), flow_extras.ignoredCounts()]);
    res.json({
      ...state,
      team_id: flow_extras.teamId(),
      messages: state.messages.map((m) => ({
        ...m,
        // A WEBHOOK source verifies nothing, and Event Gateway records its requests as `verified: false`.
        // That is "not checked here", not a rejection, so only a VERIFICATION_FAILED cause counts as one.
        ...(SOURCE_TYPE === 'LIVEKIT' ? {} : { rejected: m.rejection_cause === 'VERIFICATION_FAILED', verified: null }),
        ignored_count: ignored.get(m.request_id) ?? 0,
        bytes: Number(m.detail) || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
app.get('/api/state', (_req, res) => res.json({ fail_next: chaos.fail_next, delay_seconds: chaos.delay_seconds, source_type: SOURCE_TYPE }));

// Chaos controls: the next N deliveries fail with 503, and/or each takes N seconds to answer
app.post('/api/chaos', express.json(), (req, res) => {
  chaos.fail_next = Math.max(0, Math.min(10, Number(req.body.fail_next) || 0));
  chaos.delay_seconds = Math.max(0, Math.min(60, Number(req.body.delay_seconds) || 0));
  res.json(chaos);
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`LiveKit call log on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: POST /webhooks/livekit (forwarded by \`npm run listen\`)`);
});
