import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { DeliveryRecord, ElevenLabsEvent, HANDLED_TYPES } from './events';
import { Store } from './store';

export interface FailureMode {
  /** Respond 500 to this many more deliveries, then recover */
  fail_next: number;
}

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

/**
 * Optional: run the ElevenLabs SDK's constructEvent on what Hookdeck forwarded, so the
 * UI can show that the original ElevenLabs-Signature still verifies. Hookdeck has already
 * verified it at the source; the app does not depend on this result.
 */
async function sdkCheck(raw_body: string, signature: string | undefined, secret: string | undefined) {
  if (!secret) return undefined;
  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY || 'webhook-only' });
    await elevenlabs.webhooks.constructEvent(raw_body, signature as string, secret);
    return 'ok';
  } catch (error: any) {
    return error?.message || 'failed';
  }
}

export function webhookRouter(store: Store, failure: FailureMode): Router {
  const router = Router();

  router.post('/webhooks/elevenlabs', async (req: Request, res: Response) => {
    const raw = req.rawBody || Buffer.alloc(0);
    const body = req.body as Partial<ElevenLabsEvent> | undefined;
    const signature = req.header('elevenlabs-signature');

    const delivery: DeliveryRecord = {
      id: randomUUID(),
      received_at: new Date().toISOString(),
      type: body?.type || 'unknown',
      conversation_id: (body?.data as any)?.conversation_id,
      bytes: raw.length,
      result: 'stored',
      status_code: 200,
      hookdeck_event_id: req.header('x-hookdeck-eventid'),
      hookdeck_attempt: req.header('x-hookdeck-attempt-number') || req.header('x-hookdeck-attempt'),
      signature_header: signature ? signature.replace(/(v0=.{8}).*/, '$1...') : undefined,
    };
    const finish = (status_code: number, result: string, payload: object) => {
      delivery.status_code = status_code;
      delivery.result = result;
      store.logDelivery(delivery);
      console.log(`${delivery.type} ${delivery.conversation_id ?? ''} ${delivery.bytes} bytes -> ${status_code} ${result}`);
      res.status(status_code).json(payload);
    };

    delivery.sdk_check = await sdkCheck(raw.toString('utf8'), signature, process.env.ELEVENLABS_WEBHOOK_SECRET);

    // The retry demo: fail on purpose so Hookdeck retries the event
    if (failure.fail_next > 0) {
      failure.fail_next -= 1;
      return finish(500, 'simulated_failure', { error: 'simulated failure', fail_next: failure.fail_next });
    }

    const type = body?.type;
    const conversation_id = (body?.data as any)?.conversation_id;
    if (!type || !conversation_id || !(HANDLED_TYPES as readonly string[]).includes(type)) {
      // Acknowledge types the demo does not store so nothing retries them
      return finish(200, 'ignored', { ignored: type });
    }

    const event = body as ElevenLabsEvent;

    // Backstop for Hookdeck's deduplication rule: the same event type for the same
    // conversation is stored once, however many times it arrives.
    if (store.hasProcessed(event)) {
      return finish(200, 'duplicate', { duplicate: true });
    }

    store.apply(event, raw.length);
    return finish(200, 'stored', { received: true });
  });

  return router;
}
