import 'dotenv/config';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AgentDispatchClient, IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { AGENT_NAME, mintToken } from './token';
import { requireHookdeckSigningSecret, verifyHookdeckSignature } from './hookdeck-signature';
import { applyEvent, LiveKitEvent, summarise } from './call-log';
import { loadChronicle, loadLog, readDeliveries, recordDelivery, saveChronicle, saveLog, scrubDeliveries } from './store';
import { applyChronicle, viewChronicle } from './chronicle';
import { isScene, soundtrackReachable } from './soundtracks';
import { createSoundtrackKeeper } from './soundtrack-keeper';
import { chooseRoom, isStoryRoom, MAX_PIXELS, sceneAuthorized } from './rooms';
import { CONNECTION, PORT } from './config';
import { createFlowState } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { flow_entries, listDeliveries, listOutbound, logDelivery, logOutbound } from './deliveries';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || LIVEKIT_API_KEY.startsWith('your_')) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set. See .env.example.');
  process.exit(1);
}

requireHookdeckSigningSecret();
const log = loadLog();
const chronicle = loadChronicle();
scrubDeliveries();

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

// Express 4 does not catch a rejected promise in an async handler: wrap each one so an error is a 500, not an unhandled rejection.
const guarded = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

// Join a call from the browser. The API secret stays here: the page gets a short-lived token that
// can join one room, never the key or the secret. A Join with no room starts a new story in a room named here; a Join with `room`
// (the invite link) is accepted only for an existing, open story room this app created, never for a name the page makes up.
const open_story_rooms = async () => (await room_client.listRooms()).map((r) => r.name).filter(isStoryRoom);
app.post('/api/token', express.json(), guarded(async (req: Request, res: Response) => {
  const choice = chooseRoom(req.body?.room, await open_story_rooms());
  if ('error' in choice) return res.status(choice.status).json({ error: choice.error });
  const room = choice.room;
  const identity = `web-${randomBytes(3).toString('hex')}`;
  const name = String(req.body?.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 24) || undefined;
  res.json({ url: process.env.LIVEKIT_URL, token: await mintToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, room, identity, name), room, identity });
}));

// "Continue the story": the storyteller left the room, or stopped answering. Dispatches a new story agent to the room; it finds
// the story state in the room's metadata and picks the story up. Refused while a live story agent is still in the room.
const dispatch_client = new AgentDispatchClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
app.post('/api/story/continue', express.json(), guarded(async (req: Request, res: Response) => {
  const room = req.body?.room;
  if (!isStoryRoom(room)) return res.status(400).json({ error: 'room is required' });
  try {
    if (!(await open_story_rooms()).includes(room)) return res.status(404).json({ error: 'That story is not open.' });
    const here = await room_client.listParticipants(room);
    if (here.some((p) => p.kind === 4)) return res.status(409).json({ error: 'The storyteller is still in the room.' });
    await dispatch_client.createDispatch(room, AGENT_NAME);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
}));

// "Add a bot player": Pixel, a mute scripted traveller (agent/src/pixel.ts). It joins the room as a standard
// participant with no audio or video, and when the storyteller gives it the turn it sends one gesture line as
// a chat message. It needs `agent/` installed (`npm run agent` does that) and no LiveKit CLI.
const test_participants = new Map<string, ChildProcess>();
app.post('/api/test-participant', express.json(), guarded(async (req: Request, res: Response) => {
  const room = req.body?.room;
  if (!isStoryRoom(room)) return res.status(400).json({ error: 'Join a call first.' });
  if (test_participants.has(room)) return res.json({ ok: true, already: true });
  // Each Pixel is a Node process: cap them
  if (test_participants.size >= MAX_PIXELS) return res.status(429).json({ error: 'Too many bots are running. Try again when a story has finished.' });
  if (!(await open_story_rooms()).includes(room)) return res.status(404).json({ error: 'That story is not open.' });
  const script = path.join(__dirname, '../agent/src/pixel.ts');
  // Pixel logs to data/pixel.log, which shows what it saw and sent if a gesture doesn't arrive
  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  const log_fd = fs.openSync(path.join(__dirname, '../data/pixel.log'), 'a');
  const child = spawn(process.execPath, [script], {
    stdio: ['ignore', log_fd, log_fd],
    env: { PATH: process.env.PATH, PIXEL_URL: process.env.LIVEKIT_URL, PIXEL_TOKEN: await mintToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, room, 'bot-pixel', 'Pixel', { dispatch: false }) },
  });
  test_participants.set(room, child);
  child.on('exit', () => { test_participants.delete(room); });
  // A bot that exits straight away didn't start: see data/pixel.log for why
  const failed = await new Promise<boolean>((resolve) => {
    child.once('exit', () => resolve(true));
    setTimeout(() => resolve(false), 2500);
  });
  if (failed) return res.status(501).json({ error: 'Pixel could not join. See data/pixel.log for the reason (it needs Node.js 22.18 or later, and agent/ installed once with `npm run agent`).' });
  res.json({ ok: true });
}));
app.post('/api/test-participant/stop', express.json(), (req: Request, res: Response) => {
  test_participants.get(String(req.body?.room))?.kill();
  res.json({ ok: true });
});

// The storyteller agent (`npm run agent`) calls this at each new scene. The app pulls that scene's
// soundtrack into the room with LiveKit's Ingress API (a URL input), which produces ingress_started
// and ingress_ended webhooks that come back through Event Gateway like every other event.
const ingress_client = new IngressClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const room_client = new RoomServiceClient((process.env.LIVEKIT_URL || '').replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// One soundtrack plays per story room. It is restarted when its ingress has ended (the files are 180 s long, a scene can run longer),
// replaced at the next scene, and deleted when the story ends or the room finishes: nothing is left behind to count against the
// project's ingress limit.
const soundtracks = createSoundtrackKeeper({
  ingresses: {
    list: (room) => ingress_client.listIngress({ roomName: room }),
    create: (o) => ingress_client.createIngress(IngressInput.URL_INPUT, { name: o.name, roomName: o.room, participantIdentity: o.identity, participantName: o.participant_name, url: o.url }),
    remove: async (id) => { await ingress_client.deleteIngress(id); },
  },
  reachable: soundtrackReachable,
  room_open: async (room) => (await room_client.listRooms([room])).length > 0,
});

// At startup, sweep scene ingresses left behind by rooms that are gone.
(async () => {
  try {
    const leftovers = (await ingress_client.listIngress({})).filter((i) => i.name.startsWith('scene:'));
    const live = new Set((await room_client.listRooms()).map((r) => r.name));
    let swept = 0;
    for (const i of leftovers) {
      if (live.has(i.roomName)) continue;
      await ingress_client.deleteIngress(i.ingressId).catch(() => undefined);
      swept += 1;
    }
    if (swept) console.log(`Deleted ${swept} leftover scene ingress${swept === 1 ? '' : 'es'} from rooms that are gone`);
  } catch (error: any) {
    console.warn(`Could not sweep leftover ingresses: ${error.message}`);
  }
})();

// The agent calls these two with a secret header (src/rooms.ts): they spend LiveKit Cloud ingress minutes, and a check on the
// caller's address is not enough to know it is the agent.
const agentOnly: RequestHandler = (req, res, next) => {
  if (!sceneAuthorized(req.get('x-story-scene-secret'), LIVEKIT_API_SECRET!)) return void res.status(403).json({ error: 'agent only' });
  next();
};

app.post('/api/scene', agentOnly, express.json(), guarded(async (req: Request, res: Response) => {
  const room = req.body?.room;
  const scene = req.body?.scene;
  if (!isStoryRoom(room) || !isScene(scene)) return res.status(400).json({ error: 'room and a known scene are required' });
  const started = Date.now();
  try {
    const result = await soundtracks.ensure(room, scene);
    if (!result.ok) {
      logOutbound({ kind: 'start_ingress', room, scene, ok: false });
      console.warn(`Scene ${scene} in ${room}: no soundtrack: ${result.reason}`);
      return res.status(422).json({ ok: false, error: result.reason });
    }
    if (!result.kept) logOutbound({ kind: 'start_ingress', room, scene, ok: true });
    console.log(`Scene ${scene} in ${room}: ingress ${result.ingress_id}${result.kept ? ' (already playing)' : ` (${Date.now() - started} ms)`}`);
    res.json({ ok: true, kept: Boolean(result.kept), ingress_id: result.ingress_id });
  } catch (error: any) {
    logOutbound({ kind: 'start_ingress', room, scene, ok: false });
    console.warn(`Scene ${scene} in ${room}: ingress failed: ${error.message}`);
    res.status(502).json({ ok: false, error: error.message });
  }
}));

// The storyteller calls this when the story ends: the last soundtrack stops.
app.post('/api/scene/end', agentOnly, express.json(), guarded(async (req: Request, res: Response) => {
  const room = req.body?.room;
  if (!isStoryRoom(room)) return res.status(400).json({ error: 'room is required' });
  res.json({ ok: true, deleted: await soundtracks.stop(room).catch(() => 0) });
}));

// Failure injection, to show Hookdeck absorbing a slow or failing app
const chaos = { fail_next: 0, delay_seconds: 0 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * LiveKit webhook endpoint (via Hookdeck).
 *
 * LiveKit sends `Content-Type: application/webhook+json`, which express.json() ignores,
 * so read the body raw. Hookdeck's signature covers the exact bytes. Event Gateway verified LiveKit's own
 * token (the Authorization header, a JWT whose `sha256` claim is the hash of the body) at the LIVEKIT source,
 * so the app verifies only Hookdeck's `x-hookdeck-signature`.
 */
app.post('/webhooks/livekit', express.raw({ type: '*/*', limit: '1mb' }), guarded(async (req: Request, res: Response) => {
  const started = Date.now();
  const raw_body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const hookdeck_event_id = req.header('x-hookdeck-eventid');
  const delivery = {
    received_at: new Date().toISOString(),
    headers: req.headers,
    body_base64: raw_body.toString('base64'),
  };

  // Verify Hookdeck's signature on the raw body before anything else. There is no timestamp, so a retry or a
  // replay from hours ago still passes: Event Gateway verified LiveKit's token when it accepted the request.
  if (!verifyHookdeckSignature(raw_body, req.get('x-hookdeck-signature'), process.env.HOOKDECK_SIGNING_SECRET, req.get('x-hookdeck-signature-2'))) {
    const error = req.get('x-hookdeck-signature') ? 'x-hookdeck-signature does not match the body' : 'no x-hookdeck-signature header';
    console.warn(`Rejected webhook: ${error}`);
    recordDelivery({ ...delivery, verified: false, duplicate: false, error });
    logDelivery({ type: 'unverified', bytes: raw_body.length, status_code: 401, result: 'rejected', hookdeck_event_id }, CONNECTION, started);
    return res.status(401).json({ error: 'invalid Hookdeck signature' });
  }

  let peek: any = {};
  try { peek = JSON.parse(raw_body.toString('utf-8')); } catch { /* not JSON: nothing to apply below */ }
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
  // Use the plain JSON for the call log (the SDK parses it into protobuf types)
  try {
    const event = JSON.parse(raw_body.toString('utf-8')) as LiveKitEvent;
    const { duplicate } = applyEvent(log, event);
    applyChronicle(chronicle, event);
    // Saved before answering, and on a duplicate too: if an earlier save failed, the retry (a duplicate) saves what was applied
    saveLog(log);
    saveChronicle(chronicle);
    recordDelivery({ ...delivery, event_id: event.id, event: event.event, verified: true, duplicate });
    answered(200, duplicate ? 'duplicate' : 'applied');
    console.log(`${duplicate ? 'Duplicate' : 'Applied'} ${event.event} ${event.id} (${event.room?.name ?? event.egressInfo?.roomName ?? ''})`);
    res.json({ ok: true });
    if (!duplicate) afterEvent(event).catch((error) => console.warn(`Soundtrack follow-up after ${event.event} failed: ${error.message}`));
  } catch (error: any) {
    // Not applied: answer 5xx so Event Gateway keeps the event and retries it (the id was not recorded as seen)
    console.warn(`Could not apply the webhook: ${error.message}`);
    answered(500, 'error');
    res.status(500).json({ error: 'could not apply the event' });
  }
}));

/**
 * What a webhook sets off, after it has been applied and answered. The room is over: delete its soundtrack ingresses, unless a newer
 * room with the same name is open (a late or replayed room_finished must not stop its music). A soundtrack ended while the story is
 * still in that scene: start it again.
 */
async function afterEvent(event: LiveKitEvent): Promise<void> {
  if (event.event === 'room_finished' && event.room?.name) {
    const live = (await room_client.listRooms([event.room.name]))[0];
    if (live && event.room.sid && live.sid !== event.room.sid) return console.log(`Ignored room_finished for ${event.room.name}: a newer room with that name is open`);
    const n = await soundtracks.stop(event.room.name);
    if (n) console.log(`Deleted ${n} scene ingress after ${event.room.name} finished`);
  } else if (event.event === 'ingress_ended') {
    const info = (event as any).ingressInfo;
    if (!info?.roomName || !String(info.name).startsWith('scene:')) return;
    // An ingress_ended that names a room sid is for that room only: skip it when the open room with this name is a newer one
    const live = (await room_client.listRooms([info.roomName]))[0];
    if (live && info.state?.roomId && live.sid !== info.state.roomId) return;
    const result = await soundtracks.onEnded(info.roomName, info.name);
    if (result === 'restarted') { console.log(`Restarted the ${info.name} soundtrack in ${info.roomName}`); logOutbound({ kind: 'start_ingress', room: info.roomName, scene: String(info.name).replace(/^scene:/, ''), ok: true }); }
  }
}

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
        ignored_count: ignored.get(m.request_id) ?? 0,
        bytes: Number(m.detail) || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
app.get('/api/state', (_req, res) => res.json({ fail_next: chaos.fail_next, delay_seconds: chaos.delay_seconds }));

// Chaos controls: the next N deliveries fail with 503, and/or each takes N seconds to answer
app.post('/api/chaos', express.json(), (req, res) => {
  chaos.fail_next = Math.max(0, Math.min(10, Number(req.body.fail_next) || 0));
  chaos.delay_seconds = Math.max(0, Math.min(60, Number(req.body.delay_seconds) || 0));
  res.json(chaos);
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Anything a handler throws or rejects with ends up here: a 500 for the caller, a line in the log, no unhandled rejection
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.warn(`Request failed: ${error.message}`);
  if (!res.headersSent) res.status(500).json({ error: 'internal error' });
});

// Local only by default: the app mints tokens and controls the agent. Set HOST=0.0.0.0 to open it to your network.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`LiveKit call log on http://localhost:${PORT} (listening on ${HOST})`);
  console.log(`Webhook endpoint: POST /webhooks/livekit (forwarded by \`npm run listen\`)`);
});
