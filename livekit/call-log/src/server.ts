import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import { WebhookReceiver } from 'livekit-server-sdk';
import { applyEvent, LiveKitEvent, summarise } from './call-log';
import { loadLog, readDeliveries, recordDelivery, saveLog } from './store';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || LIVEKIT_API_KEY.startsWith('your_')) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set. See .env.example.');
  process.exit(1);
}

const PORT = process.env.PORT || 4000;
const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const log = loadLog();

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

/**
 * LiveKit webhook endpoint (via Hookdeck).
 *
 * LiveKit sends `Content-Type: application/webhook+json`, which express.json() ignores,
 * so read the body raw. The signature covers the exact bytes: the Authorization header is
 * a JWT whose `sha256` claim is the hash of the body.
 */
app.post('/webhooks/livekit', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const raw_body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
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
    // Non-2xx: Hookdeck keeps the event and can retry it
    return res.status(401).json({ error: 'invalid signature' });
  }

  // Use the plain JSON for the call log (the SDK parses it into protobuf types)
  const event = JSON.parse(raw_body.toString('utf-8')) as LiveKitEvent;
  const { duplicate } = applyEvent(log, event);
  saveLog(log);
  recordDelivery({ ...delivery, event_id: event.id, event: event.event, verified: true, duplicate });
  console.log(`${duplicate ? 'Duplicate' : 'Applied'} ${event.event} ${event.id} (${event.room?.name ?? event.egressInfo?.roomName ?? ''})`);
  res.json({ ok: true });
});

app.get('/api/calls', (_req, res) => res.json(summarise(log)));
app.get('/api/deliveries', (_req, res) => res.json(readDeliveries()));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`LiveKit call log on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: POST /webhooks/livekit (forwarded by \`npm run listen\`)`);
});
