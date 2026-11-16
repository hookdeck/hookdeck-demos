import 'dotenv/config';

export const PORT = Number(process.env.PORT || 4000);

/** Names of the things `npm run setup` creates in Hookdeck. */
export const CONNECTION = 'livekit-voice-adventure';
/** WEBHOOK (default): the app verifies each delivery. LIVEKIT: Event Gateway verifies (needs core#6254 deployed). */
export const SOURCE_TYPE = (process.env.LIVEKIT_SOURCE_TYPE || 'WEBHOOK').toUpperCase();
