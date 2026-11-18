import 'dotenv/config';

export const PORT = Number(process.env.PORT || 4000);

/** Names of the things `npm run setup` creates in Hookdeck. */
export const CONNECTION = 'livekit-voice-adventure';
/** WEBHOOK (default): the app verifies each delivery. LIVEKIT: Event Gateway verifies (needs core#6254 deployed). */
export const SOURCE_TYPE = (process.env.LIVEKIT_SOURCE_TYPE || 'WEBHOOK').toUpperCase();

/**
 * The connection's retry rule (scripts/setup-hookdeck.ts creates it): exponential backoff, 8 attempts, the first retry
 * after 30 s, then 60 s, 2 min ... up to 64 min. All the waits add up to the retry window.
 */
export const RETRY_RULE = { type: 'retry', strategy: 'exponential', count: 8, interval: 30000 } as const;
export const RETRY_WINDOW_S = Array.from({ length: RETRY_RULE.count }, (_, i) => (RETRY_RULE.interval / 1000) * 2 ** i).reduce((a, b) => a + b, 0);
