import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { IngressClient, IngressInput, RoomAgentDispatch, RoomConfiguration, WebhookReceiver } from 'livekit-server-sdk';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { mintToken } from './token';
import { applyEvent, LiveKitEvent, summarise } from './call-log';
import { loadChronicle, loadLog, readDeliveries, recordDelivery, saveChronicle, saveLog } from './store';
import { applyChronicle, viewChronicle } from './chronicle';
import { isScene, soundtrackUrl } from './soundtracks';
import { CONNECTION, PORT, SOURCE_TYPE } from './config';
import { createFlowState } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { flow_entries, listDeliveries, listOutbound, logDelivery, logOutbound } from './deliveries';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || LIVEKIT_API_KEY.startsWith('your_')) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set. See .env.example.');
  process.exit(1);
}

const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const log = loadLog();
const chronicle = loadChronicle();

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

// Join a call from the browser. The API secret stays here: the page gets a short-lived token that
// can join one room, never the key or the secret.
app.post('/api/token', express.json(), async (req: Request, res: Response) => {
  const room = String(req.body?.room || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `story-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
  const identity = `web-${randomBytes(3).toString('hex')}`;
  const name = String(req.body?.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 24) || undefined;
  res.json({ url: process.env.LIVEKIT_URL, token: await mintToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, room, identity, name), room, identity });
});

// Optional: a second participant that publishes demo media, so one person alone still gets a two-person call.
// It is what `npm run activity` does for each participant, and needs the LiveKit CLI (`lk`) on the PATH.
const test_participants = new Map<string, ChildProcess>();
app.post('/api/test-participant', express.json(), (req: Request, res: Response) => {
  const room = String(req.body?.room || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!room) return res.status(400).json({ error: 'Join a call first.' });
  if (test_participants.has(room)) return res.json({ ok: true, already: true });
  const child = spawn('lk', ['room', 'join', '--identity', 'bot-pixel', '--publish-demo', room], {
    stdio: 'ignore',
    env: { ...process.env, LK_NO_SKILLS_PROMPT: '1', LIVEKIT_URL: process.env.LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET },
  });
  child.on('error', () => { test_participants.delete(room); });
  child.on('exit', () => { test_participants.delete(room); });
  // A demo participant never outstays a demo
  setTimeout(() => child.kill(), 10 * 60 * 1000).unref();
  test_participants.set(room, child);
  child.once('error', (error: any) => { if (!res.headersSent) res.status(501).json({ error: error.code === 'ENOENT' ? 'The LiveKit CLI (lk) is not installed: brew install livekit-cli.' : error.message }); });
  setTimeout(() => { if (!res.headersSent) res.json({ ok: true }); }, 400);
});
app.post('/api/test-participant/stop', express.json(), (req: Request, res: Response) => {
  test_participants.get(String(req.body?.room))?.kill();
  res.json({ ok: true });
});

// The storyteller agent (`npm run agent`) calls this at each new scene. The app pulls that scene's
// soundtrack into the room with LiveKit's Ingress API (a URL input), which produces ingress_started
// and ingress_ended webhooks that come back through Event Gateway like every other event.
const ingress_client = new IngressClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const last_ingress = new Map<string, string>();
app.post('/api/scene', express.json(), async (req: Request, res: Response) => {
  // Only the agent on this machine calls this: it spends LiveKit Cloud ingress minutes
  const from = req.socket.remoteAddress || '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(from)) return res.status(403).json({ error: 'local only' });
  const room = String(req.body?.room || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const scene = req.body?.scene;
  if (!room || !isScene(scene)) return res.status(400).json({ error: 'room and a known scene are required' });
  const started = Date.now();
  try {
    // One soundtrack at a time: stop the previous scene's before the next starts
    const previous = last_ingress.get(room);
    if (previous) await ingress_client.deleteIngress(previous).catch(() => undefined);
    const ingress = await ingress_client.createIngress(IngressInput.URL_INPUT, {
      name: `scene:${scene}`,
      roomName: room,
      participantIdentity: `soundtrack-${scene}`,
      participantName: `Soundtrack: ${scene}`,
      url: soundtrackUrl(scene),
    });
    last_ingress.set(room, ingress.ingressId);
    logOutbound({ kind: 'start_ingress', room, scene, ok: true });
    console.log(`Scene ${scene} in ${room}: ingress ${ingress.ingressId} (${Date.now() - started} ms)`);
    res.json({ ok: true, ingress_id: ingress.ingressId });
  } catch (error: any) {
    logOutbound({ kind: 'start_ingress', room, scene, ok: false });
    console.warn(`Scene ${scene} in ${room}: ingress failed: ${error.message}`);
    res.status(502).json({ ok: false, error: error.message });
  }
});

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
  applyChronicle(chronicle, event);
  saveLog(log);
  saveChronicle(chronicle);
  recordDelivery({ ...delivery, event_id: event.id, event: event.event, verified: true, duplicate });
  answered(200, duplicate ? 'duplicate' : 'applied');
  console.log(`${duplicate ? 'Duplicate' : 'Applied'} ${event.event} ${event.id} (${event.room?.name ?? event.egressInfo?.roomName ?? ''})`);
  res.json({ ok: true });
});

app.get('/api/chronicle', (_req, res) => res.json(viewChronicle(chronicle)));
app.get('/api/outbound', (_req, res) => res.json(listOutbound()));
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
