import { HookdeckApiError, type HookdeckApi } from './hookdeck.js';

/*
 * Recovers what the agent missed while `hookdeck listen` was down. Run it after
 * `listen` prints "Connected": before that, a request retry is a no-op and an
 * event retry fails with CLI_UNAVAILABLE.
 *
 * A CLI destination misses a delivery in one of two ways, depending on how
 * `listen` went away (measured with hookdeck-cli 3.1.0):
 *
 * - Stopped cleanly, or gone for more than about 2 minutes: no event is
 *   created. Event Gateway stores the request and records an ignored event with
 *   cause CLI_DISCONNECTED. Retry the request, scoped to this connection. Not
 *   replay: replay leaves the original marked CLI_DISCONNECTED, so the next pass
 *   would find it again, while a second retry of the same request is refused.
 * - Dropped abnormally, within about 2 minutes: an event is created and each
 *   attempt fails with CLI_UNAVAILABLE. The connection's retry rule delivers it
 *   to the next session while retries remain. Once they run out the event
 *   settles as FAILED, and only then is it ours to retry.
 *
 * "Settled" means no attempt is queued or scheduled. A FAILED event with
 * `next_attempt_at` set is between automatic retries, and a manual retry then
 * delivers it twice, because the scheduled retry still fires. So anything
 * unsettled is left to Event Gateway and looked at again on the next pass.
 *
 * The agent handles each eventId once, so a duplicate that gets through anyway
 * is harmless.
 */

interface Page<T> {
  models: T[];
  pagination?: { next?: string | null };
}
interface RequestSummary {
  id: string;
  ignored_count: number;
}
interface IgnoredEvent {
  webhook_id: string;
  cause: string;
}
interface EventSummary {
  id: string;
  request_id: string;
  status: 'QUEUED' | 'SCHEDULED' | 'HOLD' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  next_attempt_at: string | null;
  response_status: number | null;
  error_code: string | null;
}

export interface RecoveryPass {
  /** Requests retried because no event was created (CLI_DISCONNECTED). */
  requestsRetried: string[];
  /** Events retried because they settled as FAILED. */
  eventsRetried: string[];
  /** Events Event Gateway is still delivering, and requests a retry couldn't deliver yet. Looked at again next pass. */
  unsettled: string[];
}

export interface RecoveryTarget {
  sourceId: string;
  connectionId: string;
}

export const isSettled = (event: Pick<EventSummary, 'status' | 'next_attempt_at'>) =>
  event.status === 'SUCCESSFUL' || event.status === 'CANCELLED' || (event.status === 'FAILED' && !event.next_attempt_at);

/** A 4xx is the agent refusing the delivery on purpose (a bad signature, say), so retrying won't help. */
const worthRetrying = (event: EventSummary) => !(event.response_status !== null && event.response_status >= 400 && event.response_status < 500);

async function all<T>(api: HookdeckApi, path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null | undefined;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const page = await api.request<Page<T>>('GET', `${path}${separator}limit=100${next ? `&next=${next}` : ''}`);
    items.push(...page.models);
    next = page.pagination?.next;
  } while (next);
  return items;
}

/**
 * One recovery pass over a connection. The source belongs to one subscription,
 * so the pass scans every request it has received. A long-lived agent would
 * keep a watermark instead; re-scanning is safe either way, because settled
 * events are skipped and a recovered request can't be retried twice.
 */
export async function recoverOnce(api: HookdeckApi, target: RecoveryTarget, log: (message: string) => void): Promise<RecoveryPass> {
  const pass: RecoveryPass = { requestsRetried: [], eventsRetried: [], unsettled: [] };

  // Requests that never became an event. `ignored_count` is checked here because
  // the API's `ignored_count[gte]` filter isn't confirmed to filter.
  const requests = await all<RequestSummary>(api, `/requests?source_id=${target.sourceId}`);
  for (const request of requests.filter((r) => r.ignored_count > 0)) {
    const ignored = await all<IgnoredEvent>(api, `/requests/${request.id}/ignored_events`);
    if (!ignored.some((e) => e.webhook_id === target.connectionId && e.cause === 'CLI_DISCONNECTED')) continue;
    try {
      const result = await api.request<{ events: EventSummary[] }>('POST', `/requests/${request.id}/retry`, { webhook_ids: [target.connectionId] });
      if (result.events.length === 0) {
        // No session is attached yet, so nothing was created. Try again next pass.
        pass.unsettled.push(request.id);
        log(`recovery: retried request ${request.id} but no listen session took it; will try again`);
      } else {
        pass.requestsRetried.push(request.id);
        log(`recovery: retried request ${request.id} (CLI_DISCONNECTED) -> ${result.events.map((e) => e.id).join(', ')}`);
      }
    } catch (error) {
      // 400 "not eligible": an earlier pass, or someone in the dashboard, already retried it.
      if (!(error instanceof HookdeckApiError && error.status === 400)) throw error;
    }
  }

  // Events that exist but weren't delivered.
  const events = await all<EventSummary>(api, `/events?webhook_id=${target.connectionId}`);
  for (const event of events) {
    if (!isSettled(event)) {
      pass.unsettled.push(event.id);
    } else if (event.status === 'FAILED' && worthRetrying(event)) {
      await api.request('POST', `/events/${event.id}/retry`);
      pass.eventsRetried.push(event.id);
      log(`recovery: retried event ${event.id} (settled FAILED, last ${event.error_code ?? event.response_status ?? 'unknown'})`);
    }
  }
  return pass;
}

export interface RecoveryOptions {
  /** Time between passes. */
  intervalMs?: number;
  /** Stop after this long, and leave anything still unsettled for the next start. */
  maxMs?: number;
  onPass?: (pass: RecoveryPass) => void;
}

/**
 * Runs a pass now, then again every `intervalMs` until a later pass finds
 * nothing to do and nothing in flight, or `maxMs` passes. The repeat matters
 * because the API can show a delivered event as missing or QUEUED for 30 s or
 * more, and an event created in the grace window takes about 10 s to fail.
 * Doesn't block: the agent keeps handling deliveries meanwhile.
 */
export function startRecovery(api: HookdeckApi, target: RecoveryTarget, log: (message: string) => void, options: RecoveryOptions = {}) {
  const intervalMs = options.intervalMs ?? 60_000;
  const deadline = Date.now() + (options.maxMs ?? 5 * 60_000);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let passes = 0;

  const run = async () => {
    if (stopped) return;
    passes++;
    let pass: RecoveryPass | undefined;
    try {
      pass = await recoverOnce(api, target, log);
      options.onPass?.(pass);
      if (pass.unsettled.length) log(`recovery: ${pass.unsettled.length} still in flight, left to Event Gateway`);
    } catch (error) {
      log(`recovery pass failed: ${(error as Error).message}`);
    }
    const quiet = pass && !pass.requestsRetried.length && !pass.eventsRetried.length && !pass.unsettled.length;
    if (stopped || (quiet && passes > 1)) return;
    if (Date.now() + intervalMs > deadline) {
      if (!quiet) log('recovery: stopping; anything left is picked up on the next start');
      return;
    }
    timer = setTimeout(run, intervalMs);
    timer.unref();
  };
  void run();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
