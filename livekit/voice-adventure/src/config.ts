import 'dotenv/config';

export const PORT = Number(process.env.PORT || 4000);

/** Names of the things `npm run setup` creates in Hookdeck. */
export const CONNECTION = 'livekit-voice-adventure';

/**
 * The connection's retry rule (scripts/setup-hookdeck.ts creates it): exponential backoff, 8 attempts, the first retry
 * after 30 s, then 60 s, 2 min ... up to 64 min.
 */
export const RETRY_RULE = { type: 'retry', strategy: 'exponential', count: 8, interval: 30000 } as const;
