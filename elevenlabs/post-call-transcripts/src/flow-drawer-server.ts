// Generated from `_shared/flow-drawer/server.ts`; edit there and run `npm run sync-shared`.
/**
 * Server side of the data-flow drawer: builds the state the drawer polls.
 *
 * It reads Event Gateway's requests, events and delivery attempts for the demo's sources with the
 * project API key, and merges in the demo's own record of what the app did (an "app feed").
 * The API key stays here: the browser only ever sees the merged state.
 *
 * Nothing in this module is specific to a platform. The demo supplies:
 *   - its sources (Hookdeck source names and the labels to show),
 *   - `describeRequest`: turns a request's body and headers into a label (e.g. "tool-calls"),
 *   - `appEntries`: the app's own events (what it returned for each delivery, and any outbound
 *     calls it made while handling one, such as a call back to the platform).
 *
 *   import { createFlowState } from './flow-drawer-server';
 *   const flow = createFlowState({
 *     apiKey: process.env.HOOKDECK_API_KEY!,
 *     sources: [{ name: 'my-source', label: 'Client A' }],
 *     describeRequest: ({ body }) => ({ label: body?.type ?? 'request', group: body?.id }),
 *     appEntries: () => app_feed,
 *   });
 *   app.get('/api/flow', flow.handler);      // Express, or any (req, res) handler of Node's http
 *
 * To correlate a delivery with the app's own record, the app notes the Hookdeck event ID it was
 * delivered (the `x-hookdeck-eventid` request header) in each `result` entry's `event_id`.
 */

/** One thing the app did, recorded by the app. */
export interface AppFlowEntry {
  id: string;
  /** ISO time the entry was recorded. */
  at: string;
  /** Hookdeck source name the delivery came through. */
  source: string;
  /** `result`: the app's answer to a delivery. `outbound`: a call the app made while handling one. */
  kind: 'result' | 'outbound';
  /** For `result`: the Hookdeck event the delivery belongs to. */
  event_id?: string;
  /** For `outbound`: the Hookdeck event being handled when the call was made. */
  parent_event_id?: string;
  /** Short title, e.g. "returned 200" or "POST controlUrl add-message". */
  label: string;
  detail?: string;
  /** HTTP status the app returned (result) or received (outbound). */
  status?: number | null;
  ok?: boolean;
  duration_ms?: number;
}

export interface FlowSource {
  /** Hookdeck source name. */
  name: string;
  /** Label to show for it. */
  label: string;
}

export interface DescribedRequest {
  /** What the message is, e.g. "tool-calls · lookup_customer". */
  label: string;
  /** Messages with the same group are shown together, e.g. a call ID. */
  group?: string;
  detail?: string;
}

export interface FlowStateOptions {
  /** Hookdeck project API key. Stays on the server. */
  apiKey: string;
  apiBase?: string;
  sources: FlowSource[];
  /** Name for the sending platform in the drawer, e.g. "Vapi". */
  senderLabel?: string;
  /** Name for the demo app in the drawer. */
  appLabel?: string;
  describeRequest?: (request: { body: any; headers: Record<string, string> }) => DescribedRequest;
  appEntries?: () => AppFlowEntry[];
  /** Most recent requests to show per source. Default 15. */
  limit?: number;
}

export interface FlowAttempt {
  id: string;
  number: number;
  trigger: string | null;
  status: string;
  at: string;
  response_status: number | null;
  /** How long the app took to answer, in ms. */
  response_latency: number | null;
  /** How long from the event being created to delivery starting, in ms. */
  delivery_latency: number | null;
  error_code: string | null;
}

export interface FlowEvent {
  id: string;
  status: string;
  created_at: string;
  next_attempt_at: string | null;
  attempts: FlowAttempt[];
  app: AppFlowEntry[];
  outbound: AppFlowEntry[];
}

export interface FlowMessage {
  request_id: string;
  source: string;
  source_label: string;
  received_at: string;
  label: string;
  group: string | null;
  detail: string | null;
  verified: boolean | null;
  rejection_cause: string | null;
  /** What Event Gateway answered the sender: 401 when verification failed, otherwise 200. */
  sender_status: number;
  events: FlowEvent[];
}

export interface FlowState {
  now: string;
  sender_label: string;
  app_label: string;
  sources: FlowSource[];
  error: string | null;
  /** Newest first. */
  messages: FlowMessage[];
}

const DEFAULT_BASE = 'https://api.hookdeck.com/2025-07-01';
const TERMINAL = new Set(['SUCCESSFUL', 'FAILED']);

export function createFlowState(options: FlowStateOptions) {
  const api_base = options.apiBase ?? DEFAULT_BASE;
  const limit = options.limit ?? 15;
  const sender_label = options.senderLabel ?? 'Sender';
  const app_label = options.appLabel ?? 'App';
  const describe = options.describeRequest ?? (() => ({ label: 'request' }));

  async function api<T = any>(route: string): Promise<T> {
    const response = await fetch(`${api_base}${route}`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Hookdeck API ${route.split('?')[0]} -> ${response.status}`);
    return response.json() as Promise<T>;
  }

  const source_ids = new Map<string, string>();
  async function sourceId(name: string): Promise<string | undefined> {
    if (!source_ids.has(name)) {
      const found = await api<{ models: Array<{ id: string; name: string }> }>(`/sources?name=${encodeURIComponent(name)}`);
      const id = found.models.find((s) => s.name === name)?.id;
      if (id) source_ids.set(name, id);
    }
    return source_ids.get(name);
  }

  // A request's body doesn't change, so each request is described once.
  const described = new Map<string, DescribedRequest>();
  // Attempts of an event that has finished don't change either.
  const finished_attempts = new Map<string, FlowAttempt[]>();

  async function describeRequests(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !described.has(id)).slice(0, 8);
    await Promise.all(
      missing.map(async (id) => {
        try {
          const detail = await api<{ data?: { body?: any; headers?: Record<string, string> } }>(`/requests/${id}`);
          described.set(id, describe({ body: detail.data?.body, headers: detail.data?.headers ?? {} }));
        } catch {
          // Try again on the next poll.
        }
      }),
    );
  }

  async function attemptsFor(event: { id: string; status: string; attempts: number }): Promise<FlowAttempt[]> {
    const cached = finished_attempts.get(event.id);
    if (cached && cached.length >= event.attempts) return cached;
    const list = await api<{ models: any[] }>(`/attempts?event_id=${event.id}&limit=20`);
    const attempts: FlowAttempt[] = list.models
      .map((a) => ({
        id: a.id,
        number: a.attempt_number,
        trigger: a.trigger ?? null,
        status: a.status,
        at: a.delivered_at ?? a.created_at,
        response_status: a.response_status ?? null,
        response_latency: a.response_latency ?? null,
        delivery_latency: a.delivery_latency ?? null,
        error_code: a.error_code ?? null,
      }))
      .sort((a, b) => a.number - b.number);
    if (TERMINAL.has(event.status)) finished_attempts.set(event.id, attempts);
    return attempts;
  }

  async function build(): Promise<FlowState> {
    const messages: FlowMessage[] = [];
    let error: string | null = null;
    const app_entries = options.appEntries?.() ?? [];

    for (const source of options.sources) {
      try {
        const id = await sourceId(source.name);
        if (!id) {
          error = `Source "${source.name}" not found in the Hookdeck project. Run the demo's setup.`;
          continue;
        }
        const [requests, events] = await Promise.all([
          api<{ models: any[] }>(`/requests?source_id=${id}&limit=${limit}`),
          api<{ models: any[] }>(`/events?source_id=${id}&limit=${limit * 2}`),
        ]);
        await describeRequests(requests.models.map((r) => r.id));
        const with_attempts = await Promise.all(
          events.models.map(async (e) => ({ e, attempts: await attemptsFor({ id: e.id, status: e.status, attempts: e.attempts }) })),
        );
        for (const r of requests.models) {
          const info = described.get(r.id);
          const rejected = r.rejection_cause === 'VERIFICATION_FAILED' || r.verified === false;
          messages.push({
            request_id: r.id,
            source: source.name,
            source_label: source.label,
            received_at: r.created_at,
            label: info?.label ?? '...',
            group: info?.group ?? null,
            detail: info?.detail ?? null,
            verified: r.verified ?? null,
            rejection_cause: r.rejection_cause ?? null,
            sender_status: rejected ? 401 : 200,
            events: with_attempts
              .filter(({ e }) => e.request_id === r.id)
              .map(({ e, attempts }) => ({
                id: e.id,
                status: e.status,
                created_at: e.created_at,
                next_attempt_at: e.next_attempt_at ?? null,
                attempts,
                app: app_entries.filter((a) => a.kind === 'result' && a.event_id === e.id),
                outbound: app_entries.filter((a) => a.kind === 'outbound' && a.parent_event_id === e.id),
              })),
          });
        }
      } catch (e) {
        error = (e as Error).message.split(options.apiKey).join('[key]');
      }
    }
    messages.sort((a, b) => b.received_at.localeCompare(a.received_at));
    return {
      now: new Date().toISOString(),
      sender_label,
      app_label,
      sources: options.sources,
      error,
      messages: messages.slice(0, limit * Math.max(1, options.sources.length)),
    };
  }

  // Several tabs and quick polls share one round of API calls.
  let cached: { at: number; state: Promise<FlowState> } | undefined;
  function state(): Promise<FlowState> {
    if (!cached || Date.now() - cached.at > 700) cached = { at: Date.now(), state: build() };
    return cached.state;
  }

  /** (req, res) handler for GET: works with Express and Node's http. */
  async function handler(_req: unknown, res: any): Promise<void> {
    try {
      const body = JSON.stringify(await state());
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message.split(options.apiKey).join('[key]') }));
    }
  }

  return { state, handler };
}

export type FlowStateService = ReturnType<typeof createFlowState>;
