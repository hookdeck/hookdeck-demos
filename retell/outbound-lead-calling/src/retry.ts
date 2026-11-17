/**
 * The retry ladder: a call that ends because the lead never picked up (no answer, busy, voicemail)
 * is not the end of the lead. The app reads the verified `call_ended` event, schedules the next
 * attempt, and gives up after the last one. The schedule is data on the lead (`attempt`,
 * `next_attempt_at`, `gave_up`); nothing dials by itself, so the page decides what a ring does.
 */
import type { Lead } from './store';

export const MAX_ATTEMPTS = 3;
/** The demo's ladder step. Short enough to watch; set RETRY_DELAY_SECONDS to change it. */
export const RETRY_DELAY_SECONDS = Number(process.env.RETRY_DELAY_SECONDS || 120);

const MISSED = new Set(['dial_no_answer', 'dial_busy', 'voicemail_reached']);

/** Whether this `disconnection_reason` means the lead did not pick up. */
export const isMissedCall = (disconnection_reason: string | undefined): boolean => MISSED.has(disconnection_reason ?? '');

/**
 * What to change on the lead when a call ends. Nothing for a call that connected or failed;
 * the next attempt's time for a missed call; `gave_up` after the last attempt.
 */
export function planRetry(attempt: number | undefined, disconnection_reason: string | undefined, now = Date.now()): Partial<Lead> {
  if (!isMissedCall(disconnection_reason)) return {};
  const current = attempt ?? 1;
  if (current >= MAX_ATTEMPTS) return { attempt: current, next_attempt_at: undefined, gave_up: true };
  return { attempt: current + 1, next_attempt_at: new Date(now + RETRY_DELAY_SECONDS * 1000).toISOString() };
}

/** True once the countdown has run out and the lead can be rung again. */
export const isRetryDue = (lead: Pick<Lead, 'next_attempt_at'>, now = Date.now()): boolean =>
  !!lead.next_attempt_at && Date.parse(lead.next_attempt_at) <= now;
