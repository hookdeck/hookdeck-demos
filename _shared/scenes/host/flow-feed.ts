import type { LiveDriver } from '../live'

// Host code (not part of a scene, and not for the website): turns the flow drawer's state
// (`GET /api/flow`: each request, its events, delivery attempts and what the app answered, see
// _shared/flow-drawer/server.ts) into live-driver calls, so packets move as real webhooks arrive.
//
// The page polls; the packets play out afterwards, so a request that Event Gateway handled in
// 80 ms is shown over a few seconds. Each request's journey is a chain: the packet along the
// `in` edge, Event Gateway's chips, then one `out` + `local` trip per delivery attempt. Journeys
// share the live driver's per-edge queues, so two webhooks a second apart never overlap.
//
// History is not replayed: the first poll marks everything already there as seen. `replay` runs
// one message's journey again from its recorded state.

export interface FeedAttempt {
  id: string
  number: number
  status: string
  response_status: number | null
  error_code: string | null
  /** When the attempt was made. */
  at?: string
  /** How long the app took to answer, in ms. */
  response_latency?: number | null
}

export interface FeedEvent {
  id: string
  status: string
  next_attempt_at: string | null
  attempts: FeedAttempt[]
  /** What the app recorded for each delivery it answered. */
  app?: Array<{ label: string, status?: number | null, detail?: string }>
}

export interface FeedMessage {
  request_id: string
  received_at: string
  label: string
  group: string | null
  verified: boolean | null
  rejected: boolean
  sender_status: number
  events: FeedEvent[]
  /** Requests Event Gateway accepted but did not turn into an event: a duplicate, under the dedup rule. */
  ignored_count?: number
  /** Size of the request body in bytes, when the server knows it. */
  bytes?: number | null
}

export interface FeedState {
  now: string
  /** Hookdeck project (team) id, for dashboard links. */
  team_id?: string
  sender_label?: string
  app_label?: string
  messages: FeedMessage[]
}

/** What the app itself reports for one delivery it answered: available a second after the webhook, long before Event Gateway's API lists the event. */
export interface FastDelivery {
  id: string
  event_id: string | null
  label: string
  bytes: number | null
  status: number
  at: string
}

export interface FlowFeedOptions {
  live: LiveDriver
  endpoint?: string
  /**
   * The app's own record of the deliveries it answered (this demo's /api/deliveries). Event
   * Gateway's API lists a request about 3 s after it arrives and its event up to 10 s, so
   * without this feed a webhook animates seconds late. With it, a delivery animates its whole
   * journey (in, verify and store, out, local) as soon as the app answers, and the flow state
   * is used for what never reaches the app: rejected requests and duplicates.
   */
  deliveries?: { endpoint: string, map: (raw: any) => FastDelivery | null, pollMs?: number }
  pollMs?: number
  /** Names of the scene's nodes, edges and chips. */
  ids?: {
    sender: string
    gateway: string
    listen: string
    app: string
    in: string
    out: string
    local: string
    verify: string
    store: string
    dedup: string
    retry: string
  }
  /** Packet label for a message, such as "audio 3.5 MB". Default: its type and size. */
  packetLabel?: (m: FeedMessage) => string
  /** Bytes at or above which a packet is drawn big. Default 1 MB. */
  bigBytes?: number
  /** Called with each message the feed starts to animate, and when the feed's state changes (for a host that shows "waiting for a webhook"). */
  onActivity?: (m: FeedMessage) => void
  /** Called with each flow state the feed polls, for a host that shows more than the feed animates. */
  onFlow?: (state: FeedState) => void
  /** Polls `fetchImpl` instead of `fetch`, for tests. */
  fetchImpl?: typeof fetch
}

const DEFAULT_IDS = {
  sender: 'agent', gateway: 'gateway', listen: 'listen', app: 'app',
  in: 'in', out: 'out', local: 'local',
  verify: 'verify', store: 'store', dedup: 'dedup', retry: 'retry',
} as const

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null)
    return ''
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const TERMINAL = new Set(['SUCCESSFUL', 'FAILED'])
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

interface Entry {
  ingested?: boolean
  chain: Promise<void>
  attempts: Set<string>
  latest: FeedMessage
  firstSeen: number
}

export function createFlowFeed(options: FlowFeedOptions) {
  const { live } = options
  const ids = { ...DEFAULT_IDS, ...options.ids }
  const endpoint = options.endpoint ?? '/api/flow'
  const pollMs = options.pollMs ?? 1000
  const bigBytes = options.bigBytes ?? 1024 * 1024
  const doFetch = options.fetchImpl ?? fetch.bind(globalThis)

  const entries = new Map<string, Entry>()
  let messages: FeedMessage[] = []
  let first = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  /** When the feed last set the app node's badge, so a host can tell its own app-side badge from the feed's. */
  let last_app_activity = 0
  const fast = options.deliveries
  const fast_seen = new Set<string>()
  const fast_events = new Map<string, { count: number, chain: Promise<void> }>()
  let fast_first = true
  let fast_timer: ReturnType<typeof setTimeout> | undefined

  const label = options.packetLabel ?? ((m: FeedMessage) => {
    const kind = m.label.replace(/^post_call_/, '').replace(/^transcription$/, 'transcript')
    const size = formatBytes(m.bytes)
    return size ? `${kind} ${size}` : kind
  })

  // A request is ready to animate once Event Gateway has decided what to do with it: it was
  // rejected, ignored as a duplicate, or turned into an event. Wait a few seconds at most.
  const decided = (m: FeedMessage) => m.rejected || (m.ignored_count ?? 0) > 0 || m.events.length > 0
  async function verdict(entry: Entry): Promise<FeedMessage> {
    while (!decided(entry.latest) && Date.now() - entry.firstSeen < 4000)
      await sleep(250)
    return entry.latest
  }

  interface Journey { label: string, bytes: number | null, request_id?: string, event_id?: string | null }

  /** The webhook reaches Event Gateway: packet in, then the chips do their work. */
  async function playIngest(j: Journey, outcome: 'ok' | 'duplicate' | 'rejected', sender_status = 200) {
    const rejected = outcome === 'rejected'
    live.badge(ids.sender, 'sending', 'blue')
    await live.send(ids.in, {
      label: j.label,
      big: (j.bytes ?? 0) >= bigBytes,
      end: outcome === 'ok' ? 'into' : 'drop',
      failed: rejected,
      data: { request_id: j.request_id, event_id: j.event_id },
    })
    live.badge(ids.sender, `got ${sender_status}`, 'success', 6)
    if (rejected) {
      live.chip(ids.verify, 'danger', 5)
      live.state(ids.gateway, 'down', 5)
      live.badge(ids.gateway, 'verification failed', 'danger', 6)
      return
    }
    live.chip(ids.verify, 'success', 3)
    await sleep(350)
    if (outcome === 'duplicate') {
      live.chip(ids.dedup, 'warn', 5)
      live.badge(ids.gateway, 'duplicate · dropped', 'warn', 6)
      return
    }
    live.chip(ids.store, 'success', 3)
    live.chip(ids.dedup, 'success', 3)
    live.badge(ids.gateway, 'verified · stored', 'success', 4)
    await sleep(300)
  }

  /** One delivery attempt: out to the CLI, local to the app, then what the app answered. */
  async function playDeliver(j: Journey, attempt_no: number, answer: { ok: boolean, text: string | number, retry_in?: number | null, final?: boolean }) {
    const data = { request_id: j.request_id, event_id: j.event_id }
    const big = (j.bytes ?? 0) >= bigBytes
    if (attempt_no > 1) {
      live.chip(ids.retry, 'warn', 3)
      live.badge(ids.gateway, `retry · attempt ${attempt_no}`, 'warn', 3)
    }
    await live.send(ids.out, { label: j.label, big, data })
    live.badge(ids.listen, 'forwarding', 'blue', 3)
    await live.send(ids.local, { label: j.label, big, end: answer.ok ? 'into' : 'bounce', data })
    last_app_activity = Date.now()
    if (answer.ok) {
      live.state(ids.app, 'ok', 4)
      live.badge(ids.app, `handled · attempt ${attempt_no}`, 'success', 8)
      live.badge(ids.gateway, attempt_no > 1 ? `delivered · attempt ${attempt_no}` : 'delivered', 'success', 5)
      if (attempt_no > 1)
        live.chip(ids.retry, 'success', 4)
      return
    }
    live.state(ids.app, 'down')
    live.badge(ids.app, `answering ${answer.text}`, 'danger')
    if (answer.final) {
      live.badge(ids.gateway, `attempt ${attempt_no} failed`, 'danger', 8)
      return
    }
    live.chip(ids.retry, 'warn')
    live.badge(ids.gateway, answer.retry_in ? `attempt ${attempt_no} failed · retry in ${answer.retry_in} s` : `attempt ${attempt_no} failed · will retry`, 'warn')
  }

  // ---- From the flow state (Event Gateway's API) ----

  async function ingest(entry: Entry) {
    const m = await verdict(entry)
    options.onActivity?.(m)
    const duplicate = !m.rejected && m.events.length === 0 && (m.ignored_count ?? 0) > 0
    await playIngest({ label: label(m), bytes: m.bytes ?? null, request_id: m.request_id }, m.rejected ? 'rejected' : duplicate ? 'duplicate' : 'ok', m.sender_status)
  }

  async function deliver(entry: Entry, event_id: string, attempt_id: string) {
    const m = entry.latest
    const event = m.events.find(e => e.id === event_id)
    const attempt = event?.attempts.find(a => a.id === attempt_id)
    if (!event || !attempt)
      return
    const retrying = !TERMINAL.has(event.status) && event.next_attempt_at
    await playDeliver({ label: label(m), bytes: m.bytes ?? null, request_id: m.request_id }, attempt.number, {
      ok: attempt.status === 'SUCCESSFUL',
      text: attempt.response_status ?? attempt.error_code ?? 'no answer',
      retry_in: retrying ? Math.max(1, Math.round((Date.parse(event.next_attempt_at!) - Date.now()) / 1000)) : null,
      final: !retrying,
    })
  }

  function track(m: FeedMessage, animate: boolean) {
    let entry = entries.get(m.request_id)
    if (!entry) {
      entry = { chain: Promise.resolve(), attempts: new Set(), latest: m, firstSeen: Date.now() }
      entries.set(m.request_id, entry)
    }
    entry.latest = m
    const e = entry
    // With the app's own delivery feed, the flow state animates only what never reaches the app.
    const never_delivered = m.rejected || (m.events.length === 0 && (m.ignored_count ?? 0) > 0)
    if (!e.ingested && animate && (!fast || never_delivered)) {
      e.ingested = true
      e.chain = e.chain.then(() => ingest(e)).catch(() => {})
    }
    else if (!animate) {
      e.ingested = true
    }
    for (const event of m.events) {
      for (const attempt of event.attempts) {
        if (e.attempts.has(attempt.id))
          continue
        e.attempts.add(attempt.id)
        if (animate && !fast)
          e.chain = e.chain.then(() => deliver(e, event.id, attempt.id)).catch(() => {})
      }
    }
  }

  // ---- From the app's own feed ----

  async function pollFast() {
    if (!fast)
      return
    try {
      const response = await doFetch(fast.endpoint, { cache: 'no-store' })
      if (response.ok) {
        const list = ((await response.json()) as any[]).map(fast.map).filter((d): d is FastDelivery => d !== null)
        list.sort((a, b) => a.at.localeCompare(b.at))
        for (const d of list) {
          if (fast_seen.has(d.id))
            continue
          fast_seen.add(d.id)
          const key = d.event_id ?? d.id
          const known = fast_events.get(key)
          const ev = known ?? { count: 0, chain: Promise.resolve() }
          fast_events.set(key, ev)
          ev.count++
          if (fast_first)
            continue
          const attempt_no = ev.count
          const kind = d.label.replace(/^post_call_/, '').replace(/^transcription$/, 'transcript')
          const size = formatBytes(d.bytes)
          const j: Journey = { label: options.packetLabel ? options.packetLabel({ label: d.label, bytes: d.bytes } as FeedMessage) : size ? `${kind} ${size}` : kind, bytes: d.bytes, event_id: d.event_id }
          const ok = d.status < 400
          ev.chain = ev.chain.then(async () => {
            if (attempt_no === 1) {
              options.onActivity?.({ label: d.label } as FeedMessage)
              await playIngest(j, 'ok')
            }
            await playDeliver(j, attempt_no, { ok, text: d.status })
          }).catch(() => {})
        }
        fast_first = false
      }
    }
    catch {
      // The next poll retries.
    }
    if (!stopped)
      fast_timer = setTimeout(pollFast, fast.pollMs ?? 700)
  }

  async function poll() {
    try {
      const response = await doFetch(endpoint, { cache: 'no-store' })
      if (response.ok) {
        const state = (await response.json()) as FeedState
        // Oldest first, so journeys queue in the order the webhooks arrived.
        options.onFlow?.(state)
        messages = [...state.messages].sort((a, b) => a.received_at.localeCompare(b.received_at))
        for (const m of messages)
          track(m, !first)
        first = false
      }
    }
    catch {
      // The page keeps polling; the drawer shows the error.
    }
    if (!stopped)
      timer = setTimeout(poll, document.hidden ? pollMs * 4 : pollMs)
  }

  return {
    start() {
      stopped = false
      void poll()
      void pollFast()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      clearTimeout(fast_timer)
    },
    /** Latest message the feed has seen, or undefined before the first poll. */
    latest(): FeedMessage | undefined {
      return messages[messages.length - 1]
    },
    messages: () => messages,
    lastAppActivity: () => last_app_activity,
    /** Runs one message's journey again from its recorded state. */
    replay(request_id?: string) {
      const m = request_id ? messages.find(x => x.request_id === request_id) : messages[messages.length - 1]
      if (!m)
        return false
      const entry: Entry = { chain: Promise.resolve(), attempts: new Set(), latest: m, firstSeen: 0 }
      entry.chain = entry.chain.then(() => ingest(entry)).catch(() => {})
      for (const event of m.events) {
        for (const attempt of event.attempts)
          entry.chain = entry.chain.then(() => deliver(entry, event.id, attempt.id)).catch(() => {})
      }
      return true
    },
  }
}
