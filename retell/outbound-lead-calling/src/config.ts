import 'dotenv/config';

export const PORT = Number(process.env.PORT || 4000);
/** Loopback by default: the endpoints trust the network path, so only expose them on purpose (HOST=0.0.0.0) */
export const HOST = process.env.HOST || '127.0.0.1';
/** Shortest gap between two phone calls placed from the form (the demo only dials one number) */
const configured_interval = Number(process.env.PHONE_DIAL_MIN_INTERVAL_SECONDS);
export const PHONE_DIAL_MIN_INTERVAL_SECONDS = process.env.PHONE_DIAL_MIN_INTERVAL_SECONDS && configured_interval >= 0 ? configured_interval : 30;
export const RETELL_API_KEY = process.env.RETELL_API_KEY || '';
/** Browser credential for web calls. Meant to be public: Retell checks it against the domains you allow. */
export const RETELL_PUBLIC_KEY = process.env.RETELL_PUBLIC_KEY || '';
export const RETELL_FROM_NUMBER = process.env.RETELL_FROM_NUMBER || '';
export const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID || '';
export const TEST_LEAD_PHONE_NUMBER = process.env.TEST_LEAD_PHONE_NUMBER || '';
/** Where the signed events from `npm run simulate` and the page's "Lead does not answer" go: the Hookdeck source `npm run setup` made. */
export const RETELL_EVENTS_URL = process.env.RETELL_EVENTS_URL || '';
/** The key Retell signs webhooks with (the webhook-badged one), which the Hookdeck source verifies with. */
export const RETELL_SIGNING_KEY = process.env.RETELL_SECRET_KEY || process.env.RETELL_API_KEY || '';
export const ENABLE_LIVE_INJECTION = process.env.ENABLE_LIVE_INJECTION === 'true';

export const RETELL_API_BASE = 'https://api.retellai.com';

/** Names of the things `npm run setup` creates in Hookdeck. */
export const EVENTS_CONNECTION = 'retell-call-events';
export const FUNCTION_CONNECTION = 'retell-live-function';

export function missingCallConfig(): string[] {
  const missing: string[] = [];
  if (!RETELL_API_KEY || RETELL_API_KEY.startsWith('your_')) missing.push('RETELL_API_KEY');
  if (!RETELL_FROM_NUMBER || RETELL_FROM_NUMBER.startsWith('+1415555')) missing.push('RETELL_FROM_NUMBER');
  if (!TEST_LEAD_PHONE_NUMBER || TEST_LEAD_PHONE_NUMBER.startsWith('+1415555')) missing.push('TEST_LEAD_PHONE_NUMBER');
  if (!RETELL_AGENT_ID) missing.push('RETELL_AGENT_ID (run npm run setup)');
  return missing;
}

/** What the browser web call needs: a public key and the agent. No API key, no phone numbers. */
export function missingWebCallConfig(): string[] {
  const missing: string[] = [];
  if (!RETELL_PUBLIC_KEY || RETELL_PUBLIC_KEY.startsWith('your_')) missing.push('RETELL_PUBLIC_KEY');
  if (!RETELL_AGENT_ID) missing.push('RETELL_AGENT_ID (run npm run setup)');
  return missing;
}
