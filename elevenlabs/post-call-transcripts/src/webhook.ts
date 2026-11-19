import { Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { DeliveryRecord, ElevenLabsEvent, HANDLED_TYPES } from './events';
import { SOURCE_NAME } from './source-name';
import { InvalidEventError, Store } from './store';
import type { AppFlowEntry } from './flow-drawer-server';
import { verifyHookdeckSignature } from './hookdeck-signature';

export interface FailureMode {
  /** Respond 500 to this many more deliveries, then recover */
  fail_next: number;
}

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

export function webhookRouter(store: Store, failure: FailureMode, flow_entries: AppFlowEntry[] = []): Router {
  const router = Router();

  router.post('/webhooks/elevenlabs', async (req: Request, res: Response) => {
    const started = Date.now();
    const raw = req.rawBody || Buffer.alloc(0);
    const body = req.body as Partial<ElevenLabsEvent> | undefined;
    const signature = req.header('elevenlabs-signature');

    const delivery: DeliveryRecord = {
      id: randomUUID(),
      received_at: new Date().toISOString(),
      type: typeof body?.type === 'string' ? body.type : 'unknown',
      conversation_id: typeof (body?.data as any)?.conversation_id === 'string' ? (body?.data as any).conversation_id : undefined,
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
      // For the data-flow drawer: what this app answered, joined to the Hookdeck event by ID
      flow_entries.push({
        id: delivery.id, at: delivery.received_at, source: SOURCE_NAME, kind: 'result',
        event_id: delivery.hookdeck_event_id, label: `returned ${status_code}`, detail: result,
        status: status_code, ok: status_code < 400, duration_ms: Date.now() - started,
      });
      if (flow_entries.length > 300) flow_entries.splice(0, flow_entries.length - 300);
      console.log(`${delivery.type} ${delivery.conversation_id ?? ''} ${delivery.bytes} bytes -> ${status_code} ${result}`);
      res.status(status_code).json(payload);
    };

    // Event Gateway verified ElevenLabs-Signature when it accepted the request. This app verifies Hookdeck's
    // signature on the raw body before it does anything else. There is no timestamp, so a retry or replay
    // from hours ago still passes.
    if (!verifyHookdeckSignature(raw, req.header('x-hookdeck-signature'), process.env.HOOKDECK_SIGNING_SECRET, req.header('x-hookdeck-signature-2'))) {
      return finish(401, 'signature_rejected', { error: 'invalid Hookdeck signature' });
    }

    // The retry demo: fail on purpose so Hookdeck retries the event
    if (failure.fail_next > 0) {
      failure.fail_next -= 1;
      return finish(500, 'simulated_failure', { error: 'simulated failure', fail_next: failure.fail_next });
    }

    const type = body?.type;
    const conversation_id = (body?.data as any)?.conversation_id;
    if (typeof type !== 'string' || !conversation_id || !(HANDLED_TYPES as readonly string[]).includes(type)) {
      // Acknowledge types the demo does not store so nothing retries them
      return finish(200, 'ignored', { ignored: type });
    }

    const event = body as ElevenLabsEvent;

    // Backstop for Hookdeck's deduplication rule: the same event type for the same
    // conversation is stored once, however many times it arrives.
    if (store.hasProcessed(event)) {
      return finish(200, 'duplicate', { duplicate: true });
    }

    try {
      store.apply(event, raw.length);
    } catch (error) {
      if (error instanceof InvalidEventError) return finish(400, 'invalid_payload', { error: error.message });
      console.error(error);
      return finish(500, 'error', { error: 'could not store the event' });
    }
    return finish(200, 'stored', { received: true });
  });

  return router;
}
