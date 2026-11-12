import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Store } from './store';
import { createFlowState, AppFlowEntry } from './flow-drawer-server';
import { createFlowExtras } from './flow-extras';
import { SOURCE_NAME } from './source-name';
import { FailureMode, webhookRouter } from './webhook';

const PORT = process.env.PORT || 4000;


export function createApp(data_dir: string) {
const app = express();
const store = new Store(data_dir);
const failure: FailureMode = { fail_next: 0 };

app.use(
  express.json({
    limit: '100mb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);

const flow_entries: AppFlowEntry[] = [];
app.use(webhookRouter(store, failure, flow_entries));

// Data-flow drawer: Event Gateway's requests, events and delivery attempts for the source (read with
// the project API key, here on the server) merged with what this app answered.
const flow = createFlowState({
  apiKey: process.env.HOOKDECK_API_KEY || '',
  senderLabel: 'ElevenLabs',
  appLabel: 'Demo app',
  // ELEVENLABS sources are verified after ingestion: a bad signature still gets 200
  rejectedStatus: 200,
  sources: [{ name: SOURCE_NAME, label: 'ElevenLabs agent' }],
  appEntries: () => flow_entries,
  describeRequest: ({ body, headers }) => ({
    label: body?.type ?? 'not an ElevenLabs event',
    group: body?.data?.conversation_id,
    // The request's size, for the topology view's packets (the drawer doesn't show `detail`).
    detail: headers['content-length'],
  }),
});
// The topology view reads the same state plus ignored duplicates and request sizes.
const flow_extras = createFlowExtras(process.env.HOOKDECK_API_KEY || '', SOURCE_NAME);
app.get('/api/flow', async (_req, res) => {
  try {
    const [state, ignored] = await Promise.all([flow.state(), flow_extras.ignoredCounts()]);
    res.json({
      ...state,
      messages: state.messages.map((m) => ({ ...m, ignored_count: ignored.get(m.request_id) ?? 0, bytes: Number(m.detail) || null })),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Start call button: the browser asks for a signed URL; the API key stays on the server.
app.get('/api/config', (_req, res) =>
  res.json({
    agent_configured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID),
    suggested_line: 'Hi, I would like to book a haircut on Friday afternoon. My name is Sam.',
  }),
);
app.post('/api/signed-url', async (_req: Request, res: Response) => {
  const api_key = process.env.ELEVENLABS_API_KEY;
  const agent_id = process.env.ELEVENLABS_AGENT_ID;
  if (!api_key || !agent_id) return res.status(400).json({ error: 'ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required in .env' });
  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: api_key });
    const { signedUrl } = await elevenlabs.conversationalAi.conversations.getSignedUrl({ agentId: agent_id });
    res.json({ signed_url: signedUrl });
  } catch (error: any) {
    res.status(502).json({ error: error?.body?.detail?.message || error?.message || 'Could not get a signed URL' });
  }
});
app.get('/api/conversations', (_req, res) => res.json(store.listConversations()));
app.get('/api/deliveries', (_req, res) => res.json(store.listDeliveries()));
app.get('/api/state', (_req, res) =>
  res.json({
    fail_next: failure.fail_next,
    sdk_check: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET),
  }),
);
app.post('/api/fail-next', (req: Request, res: Response) => {
  const count = Number(req.body?.count ?? 1);
  failure.fail_next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  res.json({ fail_next: failure.fail_next });
});
app.post('/api/reset', (_req, res) => {
  store.reset();
  res.json({ reset: true });
});
app.get('/audio/:conversation_id.mp3', (req: Request, res: Response) => {
  const file = store.audioPath(req.params.conversation_id);
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

return { app, store, failure };
}

if (require.main === module) {
  const { app } = createApp(path.join(__dirname, '../data'));
  app.listen(PORT, () => {
    console.log(`ElevenLabs post-call transcripts running on http://localhost:${PORT}`);
    console.log(`Webhook endpoint: POST /webhooks/elevenlabs (forwarded by 'npm run listen')`);
  });
}
