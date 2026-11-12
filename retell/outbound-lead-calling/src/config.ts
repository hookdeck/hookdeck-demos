import 'dotenv/config';

export const PORT = Number(process.env.PORT || 4000);
export const RETELL_API_KEY = process.env.RETELL_API_KEY || '';
export const RETELL_FROM_NUMBER = process.env.RETELL_FROM_NUMBER || '';
export const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID || '';
export const TEST_LEAD_PHONE_NUMBER = process.env.TEST_LEAD_PHONE_NUMBER || '';
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

/** What the in-page "Start call" button needs (no phone numbers involved). */
export function missingWebCallConfig(): string[] {
  const missing: string[] = [];
  if (!RETELL_API_KEY || RETELL_API_KEY.startsWith('your_')) missing.push('RETELL_API_KEY');
  if (!RETELL_AGENT_ID) missing.push('RETELL_AGENT_ID (run npm run setup)');
  return missing;
}
